'use strict';
const { bot, users, Coll } = require('./helpers/load-bot');
const assert = require('assert');
const { client, db } = bot;

// ---- fake guild ----
let seq = 0;
const bans = new Map();
const unbanned = [];
const mkChan = (o) => {
  const store = new Map();
  const ch = { id: 'C' + ++seq, name: o.name, opts: o, store,
    send: async (p) => { const m = { id: 'M' + ++seq, payload: p, edit: async (x) => { m.payload = x; }, delete: async () => {} }; store.set(m.id, m); return m; },
    messages: { fetch: async (id) => { if (!store.has(id)) throw new Error('nf'); return store.get(id); } },
    setPosition: async () => {}, delete: async () => { guild.channels.cache.delete(ch.id); } };
  return ch;
};
const guild = {
  id: 'G1', ownerId: 'OWNER', roles: { everyone: { id: 'G1' } },
  members: {
    me: { id: 'BOT', permissions: { missing: () => [] } },
    fetch: async (id) => ({ permissions: { has: () => id === 'MOD' } }),
    ban: async (uid, o) => { if (uid === '1003') { const e = new Error('Missing Permissions'); e.code = 50013; throw e; } bans.set(uid, o); },
    unban: async (uid) => { if (!bans.has(uid)) { const e = new Error('Unknown Ban'); e.code = 10026; throw e; } bans.delete(uid); unbanned.push(uid); },
  },
  channels: { cache: new Map(), create: async (o) => { const c = mkChan(o); guild.channels.cache.set(c.id, c); return c; } },
};
client.guilds.cache.set('G1', guild);

const mkMsg = (uid, content, chId, member) => ({ guild, author: { id: uid, username: 'user_' + uid, bot: false }, member, content, channelId: chId, attachments: { size: 0 }, system: false, webhookId: null, deletedFlag: false, delete: async function () { this.deletedFlag = true; } });

(async () => {
  // 1) เปิดระบบ
  await bot.enableTrap(guild);
  const t = bot.trapCfg('G1');
  assert(t.enabled && t.trapChannelId && t.logChannelId && t.trapMsgId, 'enable sets ids');
  const trapCh = guild.channels.cache.get(t.trapChannelId), logCh = guild.channels.cache.get(t.logChannelId);
  assert.strictEqual(trapCh.opts.position, 0, 'trap at top');
  assert(logCh.name === '︱・𝗔𝗻𝘁𝗶𝗦𝗽𝗮𝗺', 'log = AntiSpam channel');
  assert(logCh.opts.permissionOverwrites.some((o) => o.id === 'G1' && o.deny), 'log hidden from everyone');
  const cat = [...guild.channels.cache.values()].find((c) => c.opts.type === 4); assert(cat && cat.name === '𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀' && logCh.opts.parent === cat.id, 'inside private category');
  assert(db.G1.logChannelId === logCh.id, 'shared with Anti-Spam log');
  console.log('1 enable OK  trap=', trapCh.name, ' log=', logCh.name);

  // 2) คนทั่วไปพิมพ์ -> แบน
  const m1 = mkMsg('1001', 'free nitro http://x.y @everyone', t.trapChannelId, { permissions: { has: () => false } });
  await bot.handleTrapMessage(m1);
  { const last = [...logCh.store.values()].at(-1).payload; const tx = JSON.stringify(last); assert((last.flags & 32768) && last.content === undefined, 'trap log V2'); assert(tx.includes('ลบข้อความในห้องดัก') && tx.includes('แบนผู้ใช้ 3 วัน') && tx.includes('ตั้งปลดแบนอัตโนมัติ'), 'log lists what Killua did'); }
  assert(m1.deletedFlag && bans.has('1001'), 'deleted+banned');
  assert.strictEqual(bans.get('1001').deleteMessageSeconds, 86400);
  assert.strictEqual(t.all, 1); assert.strictEqual(t.today, 1);
  assert(t.pending['1001'] - Date.now() > 3 * 86400000 - 5000, '3 day pending');
  const logMsg = [...logCh.store.values()][0];
  assert(logMsg, 'log posted'); assert.deepStrictEqual(logMsg.payload.allowedMentions, { parse: [] });
  console.log('2 ban OK');

  // 3) รัวข้อความซ้ำ -> ไม่แบนซ้ำ/ไม่ log ซ้ำ
  const m1b = mkMsg('1001', 'again', t.trapChannelId, { permissions: { has: () => false } });
  await bot.handleTrapMessage(m1b);
  assert(m1b.deletedFlag && logCh.store.size === 1 && t.all === 1, 'dedupe');
  console.log('3 dedupe OK');

  // 4) ทีมงาน / เจ้าของ ไม่โดนแบน
  const mm = mkMsg('MOD', 'hi', t.trapChannelId, { permissions: { has: () => true } });
  await bot.handleTrapMessage(mm); assert(!mm.deletedFlag && !bans.has('MOD'));
  const mo = mkMsg('OWNER', 'hi', t.trapChannelId, null); await bot.handleTrapMessage(mo); assert(!bans.has('OWNER'));
  console.log('4 exempt OK');

  // 5) แบนไม่ได้ (ยศสูงกว่า) -> log failed ไม่นับสถิติ
  const mh = mkMsg('1003', 'x', t.trapChannelId, { permissions: { has: () => false } });
  await bot.handleTrapMessage(mh);
  assert.strictEqual(t.all, 1, 'failed not counted'); assert(!t.pending['1003']);
  assert(Object.values(t.cases).some((c) => c.uid === '1003' && c.status === 'failed'));
  console.log('5 ban-fail OK');

  // 6) ปุ่มปลดแบน
  const mkBtn = (cid, perms, msgId) => { const out = {}; return { out, guild, user: { id: 'ADMIN', tag: 'admin' }, customId: cid, message: { id: msgId }, channelId: logCh.id,
    isChatInputCommand: () => false, isButton: () => true,
    memberPermissions: { has: () => perms }, deferUpdate: async () => {}, editReply: async (p) => { out.edit = p; }, reply: async (p) => { out.reply = p; }, followUp: async (p) => { out.follow = p; } }; };
  const case1 = Object.keys(t.cases).find((k) => t.cases[k].uid === '1001');
  let b = mkBtn('trap_unban:1001', false, case1); await bot.handleTrapInteraction(b); assert(b.out.reply && bans.has('1001'), 'no perm blocks');
  b = mkBtn('trap_unban:1001', true, case1); await bot.handleTrapInteraction(b);
  assert(!bans.has('1001') && !t.pending['1001'] && t.cases[case1].status === 'unbanned' && b.out.edit, 'unban works');
  console.log('6 unban button OK');

  // 7) เพิกเฉย + หมดเวลาอัตโนมัติ
  await bot.handleTrapMessage(mkMsg('1002', 'spam', t.trapChannelId, { permissions: { has: () => false } }));
  const case2 = Object.keys(t.cases).find((k) => t.cases[k].uid === '1002');
  b = mkBtn('trap_ignore:1002', true, case2); await bot.handleTrapInteraction(b);
  assert(t.cases[case2].status === 'ignored' && bans.has('1002') && t.pending['1002'], 'ignore keeps ban');
  await bot.processTrapUnbans(); assert(bans.has('1002'), 'not yet expired');
  t.pending['1002'] = Date.now() - 1000;
  await bot.processTrapUnbans();
  assert(!bans.has('1002') && !t.pending['1002'] && t.cases[case2].status === 'expired', 'auto unban');
  console.log('7 ignore + auto-unban OK');

  // 8) ปิดระบบ -> ลบห้องดัก เก็บ log
  await bot.disableTrap(guild);
  assert(!t.enabled && !t.trapChannelId && t.logChannelId && guild.channels.cache.has(t.logChannelId));
  // เปิดใหม่ ใช้ห้อง log เดิม
  const oldLog = t.logChannelId; await bot.enableTrap(guild); assert.strictEqual(t.logChannelId, oldLog);
  console.log('8 disable/re-enable OK');

  // 9) สร้างแผง/ข้อความ ได้ครบ ทั้ง 2 ภาษา
  for (const lang of ['th', 'en']) { db.G1.lang = lang; bot.buildTrapPanel(guild, 'x'); bot.buildTrapMessage(guild); bot.buildTrapLog('G1', { uid: '1', tag: 't', channelId: 'c', content: 'c', until: Date.now() }, 'banned'); }
  console.log(bot.tr('G1', 'trHead'), '|', bot.tr('G1', 'lgBanned', 1234));
  db.G1.lang = 'th'; console.log(bot.tr('G1', 'trHead'), '|', bot.tr('G1', 'trPunishVal', 3));
  console.log('ALL TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
