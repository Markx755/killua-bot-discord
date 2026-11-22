'use strict';
// ทดสอบ /ประกาศ, Anti-Nuke, และว่า log/แจ้งเตือนทุกอันเป็น UI V2 (ไม่มี content ธรรมดา)
const { bot, Coll } = require('./helpers/load-bot');
const assert = require('assert');
const { client, db } = bot;

const V2 = 32768;
const isV2 = (p) => (p.flags & V2) === V2 && p.content === undefined && !p.embeds;
let seq = 0;
const bans = [];
const stripped = [];
const audit = []; // รายการ audit log ปลอม
let banFail = false;

const mkChan = (o) => {
  const ch = { id: 'C' + ++seq, name: o.name, type: o.type, opts: o, sent: [],
    isTextBased: () => o.type === 0,
    permissionsFor: () => ({ has: () => ch.canEveryone !== false }),
    send: async (p) => { const m = { id: 'M' + ++seq, payload: p, edit: async (x) => { m.payload = x; }, delete: async () => {} }; ch.sent.push(m); return m; },
    messages: { fetch: async () => null }, setPosition: async () => {}, delete: async () => {} };
  return ch;
};
const guild = {
  id: 'G5', name: 'T', ownerId: 'OWN', roles: { everyone: { id: 'G5' } },
  members: {
    me: { id: 'BOT', permissions: { missing: () => [] } },
    fetch: async (id) => ({ id, roles: { set: async (r) => { stripped.push(id); } } }),
    ban: async (id, o) => { if (banFail) throw new Error('Missing Permissions'); bans.push({ id, o }); },
  },
  channels: { cache: new Coll(), create: async (o) => { const c = mkChan(o); guild.channels.cache.set(c.id, c); return c; } },
  fetchAuditLogs: async () => ({ entries: new Coll(audit.map((e, k) => [k, e])) }),
};
client.guilds.cache.set('G5', guild);

const reply = [];
const mkI = (o) => ({
  guild, member: { id: 'ADM' }, user: { id: 'ADM', tag: 'adm' }, channel: { id: 'X' },
  memberPermissions: { has: () => o.noPerm !== true },
  isChatInputCommand: () => !!o.cmd, isModalSubmit: () => !!o.modal, isButton: () => !!o.btn, isChannelSelectMenu: () => false,
  commandName: o.cmd, customId: o.modal || o.btn,
  options: { getChannel: () => o.channel ?? null },
  fields: { getTextInputValue: (k) => o.fields[k] ?? '' },
  reply: async (p) => { reply.push(p); }, showModal: async (m) => { reply.push({ modal: m }); },
  deferUpdate: async () => {}, editReply: async (p) => { reply.push(p); },
});
const text = (p) => JSON.stringify(p);

(async () => {
  // ---------- สร้างหมวด log ผ่าน /antinuke ----------
  let i = mkI({ btn: 'nuke_on' });
  assert(await bot.handleNukeInteraction(i));
  const cat = [...guild.channels.cache.values()].find((c) => c.type === 4);
  const nukeCh = [...guild.channels.cache.values()].find((c) => c.name === '︱・𝗔𝗻𝘁𝗶𝗡𝘂𝗸𝗲');
  assert(cat && nukeCh && db.G5.nuke.enabled && db.G5.nuke.logChannelId === nukeCh.id, 'antinuke enable creates + links channel');
  assert(isV2(reply.at(-1)), 'panel V2'); console.log('1 /antinuke enable OK');

  // ---------- /ประกาศ ----------
  const target = mkChan({ name: 'general', type: 0 }); guild.channels.cache.set(target.id, target);
  reply.length = 0;
  i = mkI({ cmd: 'ประกาศ', channel: target });
  assert(await bot.handleAnnounceInteraction(i) && reply[0].modal, 'opens modal');
  i = mkI({ cmd: 'ประกาศ', noPerm: true }); reply.length = 0; await bot.handleAnnounceInteraction(i);
  assert(!reply[0].modal && /Mention Everyone/.test(text(reply[0])), 'blocked without Mention Everyone');

  reply.length = 0;
  i = mkI({ modal: 'ann_modal:' + target.id, fields: { title: 'อัปเดต', text: 'ข้อความทดสอบ', image: 'https://x.test/a.png' } });
  await bot.handleAnnounceInteraction(i);
  const ann = target.sent.at(-1).payload;
  assert(isV2(ann), 'announcement is V2'); assert(ann.allowedMentions.parse.includes('everyone'), 'allowed to ping everyone');
  assert(text(ann).includes('@everyone'), 'contains @everyone'); assert(text(ann).includes('ข้อความทดสอบ') && text(ann).includes('https://x.test/a.png'));
  assert(/ส่งประกาศ/.test(text(reply[0])), 'ephemeral confirm');
  const annLog = [...guild.channels.cache.values()].find((c) => c.name === '╭・𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀');
  assert(annLog.sent.length === 1 && isV2(annLog.sent[0].payload), 'announce logged (V2) in Announcements'); console.log('2 /ประกาศ OK');

  // ประกาศซ้ำ = @everyone ทุกครั้ง
  await bot.handleAnnounceInteraction(mkI({ modal: 'ann_modal:' + target.id, fields: { title: 'b', text: 'c' } }));
  assert(target.sent.length === 2 && text(target.sent[1].payload).includes('@everyone')); console.log('2b @everyone every time OK');

  // บอทไม่มีสิทธิ์ในห้อง / ลิ้งภาพผิด
  target.canEveryone = false; reply.length = 0;
  await bot.handleAnnounceInteraction(mkI({ modal: 'ann_modal:' + target.id, fields: { title: 'b', text: 'c' } }));
  assert(target.sent.length === 2 && /Mention Everyone/.test(text(reply[0]))); target.canEveryone = true;
  reply.length = 0; await bot.handleAnnounceInteraction(mkI({ modal: 'ann_modal:' + target.id, fields: { title: 'b', text: 'c', image: 'ftp://x' } }));
  assert(target.sent.length === 2 && /http/.test(text(reply[0]))); console.log('2c guards OK');

  // ---------- Anti-Nuke ----------
  const del = (id, name) => { audit.unshift({ targetId: id, createdTimestamp: Date.now(), executor: { id: 'EVIL', username: 'evil' } }); return client.listeners('channelDelete').map((f) => f({ guild, id, name })); };
  await del('c1', 'a'); await del('c2', 'b');
  await new Promise((r) => setTimeout(r, 30));
  assert(bans.length === 0, '2 deletes < limit 3');
  await del('c3', 'c'); await new Promise((r) => setTimeout(r, 30));
  assert(bans.length === 1 && bans[0].id === 'EVIL', 'banned at limit');
  const lg = nukeCh.sent.at(-1).payload; assert(isV2(lg), 'nuke log V2');
  assert(text(lg).includes('EVIL') && text(lg).includes('#a') && text(lg).includes('#c'), 'log lists culprit + items'); assert(db.G5.nuke.count === 1);
  await del('c4', 'd'); await new Promise((r) => setTimeout(r, 30)); assert(bans.length === 1, 'no double punish within cooldown');
  console.log('3 anti-nuke ban + V2 log OK');

  // เจ้าของเซิร์ฟเวอร์ถูกข้าม
  audit.length = 0; bans.length = 0;
  for (let k = 0; k < 5; k++) { audit.unshift({ targetId: 'o' + k, createdTimestamp: Date.now(), executor: { id: 'OWN', username: 'owner' } }); client.listeners('channelDelete')[0]({ guild, id: 'o' + k, name: 'x' }); }
  await new Promise((r) => setTimeout(r, 30)); assert(bans.length === 0, 'owner exempt'); console.log('3b owner exempt OK');

  // แบนไม่ได้ -> ถอดยศ
  audit.length = 0; banFail = true;
  for (let k = 0; k < 3; k++) { audit.unshift({ targetId: 'r' + k, createdTimestamp: Date.now(), executor: { id: 'EVIL2', username: 'evil2' } }); client.listeners('roleDelete')[0]({ guild, id: 'r' + k, name: 'role' + k }); }
  await new Promise((r) => setTimeout(r, 30));
  assert(stripped.includes('EVIL2'), 'fallback strips roles'); assert(/ถอดยศ/.test(text(nukeCh.sent.at(-1).payload))); banFail = false; console.log('3c ban-fail fallback OK');

  // ปิดระบบ = ไม่ทำอะไร
  await bot.handleNukeInteraction(mkI({ btn: 'nuke_off' })); audit.length = 0; bans.length = 0; stripped.length = 0;
  for (let k = 0; k < 4; k++) { audit.unshift({ targetId: 'z' + k, createdTimestamp: Date.now(), executor: { id: 'EVIL3', username: 'e' } }); client.listeners('channelDelete')[0]({ guild, id: 'z' + k, name: 'z' }); }
  await new Promise((r) => setTimeout(r, 30)); assert(bans.length === 0, 'disabled'); console.log('3d disabled OK');

  // ---------- log อื่นๆ เป็น V2 ----------
  const spamCh = [...guild.channels.cache.values()].find((c) => c.name === '︱・𝗔𝗻𝘁𝗶𝗦𝗽𝗮𝗺');
  assert.strictEqual(db.G5.logChannelId, spamCh.id);
  await bot.sendLog(guild, `${bot.E.warn} **Anti-Spam** | test`);
  assert(isV2(spamCh.sent.at(-1).payload) && text(spamCh.sent.at(-1).payload).includes('<a:emoji_'), 'sendLog V2 + server emoji');
  const joinCh = [...guild.channels.cache.values()].find((c) => c.name === '╰・𝗝𝗼𝗶𝗻𝗚𝗮𝘁𝗲');
  db.G5.verify = { roleId: 'R', logChannelId: joinCh.id };
  assert(await bot.grantVerified(guild, { roles: { add: async () => {} } }, { tag: 'u#1', id: '9' }));
  await new Promise((r) => setTimeout(r, 10));
  assert(isV2(joinCh.sent.at(-1).payload), 'JoinGate log V2'); console.log('4 other logs V2 OK');

  // ข้อความ TH/EN ครบ
  for (const l of ['th', 'en']) { db.G5.lang = l; bot.buildNukePanel(guild, 'x'); bot.buildAnnouncement('G5', '1', 't', 'x', ''); for (const k of ['annNoPerm', 'nkTitle', 'nkDidBan', 'lgActDel']) assert(bot.tr('G5', k) && !/undefined/.test(bot.tr('G5', k)), k + ' ' + l); }
  console.log('ALL FEATURE TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
