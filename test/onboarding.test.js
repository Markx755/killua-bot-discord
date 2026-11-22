'use strict';
const { bot, users, Coll } = require('./helpers/load-bot');
const assert = require('assert');
const { client, db } = bot;

let seq = 0;
const mkUser = (id, { dmFail = false } = {}) => { const u = { id, tag: 't' + id, sent: [], send: async (p) => { if (dmFail) throw Object.assign(new Error('Cannot send'), { code: 50007 }); const m = { id: 'DM' + ++seq, channelId: 'DMC' + id, payload: p, edit: async (x) => { m.payload = x; } }; u.sent.push(m); return m; }, createDM: async () => ({ messages: { fetch: async (mid) => u.sent.find((m) => m.id === mid) } }) }; users.set(id, u); return u; };

function mkGuild(gid, { botAdmin = false, botPos = 1, ownerId = 'OWN', locale = 'th' } = {}) {
  const roles = new Coll();
  roles.set(gid, { id: gid, position: 0, managed: false });
  roles.set('R_STAFF', { id: 'R_STAFF', position: 5, managed: false });
  const botRole = { id: 'R_BOT', position: botPos, managed: true }; roles.set('R_BOT', botRole);
  const chans = new Coll();
  const g = { id: gid, name: 'TestGuild', ownerId, preferredLocale: locale, left: false, botRole, adminFlag: botAdmin, roles: { cache: roles, everyone: { id: gid } }, channels: { cache: chans, create: async (o) => { const c = { id: 'CH' + ++seq, name: o.name, type: o.type, opts: o, sent: [], send: async (p) => { const m = { id: 'M' + ++seq, payload: p, edit: async (x) => { m.payload = x; } }; c.sent.push(m); return m; }, messages: { fetch: async (id) => c.sent.find((m) => m.id === id) }, permissionsFor: () => ({ has: () => true }) }; chans.set(c.id, c); return c; } },
    systemChannel: null, leave: async () => { g.left = true; },
    fetchAuditLogs: async () => ({ entries: { find: (f) => [{ target: { id: 'BOT' }, executor: users.get('INV'), createdTimestamp: Date.now() }].find(f) } }),
    members: { fetch: async (id) => ({ id, permissions: { has: () => id === 'INV' || id === 'OWN' }, roles: { highest: { position: id === 'INV' ? 3 : 9 } } }), fetchMe: async () => g.members.me } };
  g.members.me = { id: 'BOT', permissions: { has: () => g.adminFlag }, roles: { get highest() { return g.botRole; } } };
  client.guilds.cache.set(gid, g); return g;
}
// Updated mkBtn: supports both update and deferUpdate+editReply patterns
const mkBtn = (cid, user, { dm = true } = {}) => { const o = {}; return { o, customId: cid, user, guild: dm ? null : undefined, isButton: () => true, isChatInputCommand: () => false,
  update: async (p) => { o.update = p; o.replied = true; }, deferUpdate: async () => { o.defer = true; o.deferred = true; }, editReply: async (p) => { o.edit = p; o.edits = (o.edits || []).concat([p]); o.replied = true; }, reply: async (p) => { o.reply = p; o.replied = true; }, replied: false, deferred: false }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (p) => JSON.stringify(p).length; // payload is proxy; just ensure it exists

(async () => {
  mkUser('INV'); mkUser('OWN'); mkUser('STRANGER');
  // ---------- A) เส้นทางหลัก ----------
  const gA = mkGuild('1001');
  client.emit('guildCreate', gA); await sleep(50);
  const inv = users.get('INV'); const ob = db['1001'].onboard;
  assert(inv.sent.length === 1 && ob.state === 'ask' && ob.dm && ob.userId === 'INV', 'DM ask sent to inviter'); assert.strictEqual(db['1001'].lang, 'th');
  console.log('A1 DM confirm sent to inviter OK');

  let b = mkBtn('ob_start:1001', users.get('STRANGER')); await bot.handleOnboardInteraction(b);
  assert(b.o.reply && !b.o.update, 'stranger blocked'); console.log('A2 unauthorized blocked OK');

  b = mkBtn('ob_start:1001', inv); await bot.handleOnboardInteraction(b);
  // Now uses deferUpdate + editReply for safety
  assert((b.o.defer || b.o.update) && ob.state === 'perms' && !ob.waiting, 'perms panel'); console.log('A3 step2 panel OK');

  b = mkBtn('ob_check:1001', inv); await bot.handleOnboardInteraction(b);
  // For 'check' with perms missing, we now defer then editReply
  assert((b.o.defer || b.o.update) && ob.waiting, 'waiting when perms missing'); assert.strictEqual(gA.channels.cache.size, 0, 'nothing created yet');
  console.log('A4 waiting state OK');

  // บอทได้ Administrator + ยศสูงกว่า (INV top=3) แต่ยังไม่สูงสุด (STAFF=5): ผู้ตั้งค่าไม่ใช่เจ้าของ → ผ่าน
  gA.adminFlag = true; gA.botRole.position = 4; client.emit('roleUpdate', {}, { guild: gA }); await sleep(2600);
  assert(ob.state === 'done' && gA.channels.cache.size === 5, 'auto-detected -> setup ran: ' + ob.state + ' ' + gA.channels.cache.size);
  const dmMsg = inv.sent[0]; assert(dmMsg.payload, 'DM edited');
  const names = [...gA.channels.cache.values()].map((c) => c.name);
  console.log('A5 auto-continue OK ->', names.join(' | '));
  const cat = [...gA.channels.cache.values()].find((c) => c.type === 4); assert.strictEqual(cat.name, '𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀'); assert.deepStrictEqual(names.filter((n) => n !== cat.name), ['╭・𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀', '︱・𝗔𝗻𝘁𝗶𝗦𝗽𝗮𝗺', '︱・𝗔𝗻𝘁𝗶𝗡𝘂𝗸𝗲', '╰・𝗝𝗼𝗶𝗻𝗚𝗮𝘁𝗲']);
  assert([...gA.channels.cache.values()].filter((c) => c.type === 0).every((c) => c.opts.parent === cat.id), 'all under category');
  const ov = cat.opts.permissionOverwrites; assert(ov.some((x) => x.id === '1001' && x.deny) && ov.some((x) => x.id === 'OWN') && ov.some((x) => x.id === 'BOT'), 'private: Killua + owner only'); assert(!ov.some((x) => x.id === 'INV'), 'inviter not added (owner only)');
  assert(db['1001'].logChannelId && db['1001'].trap.logChannelId && db['1001'].verify.logChannelId && db['1001'].nuke.logChannelId, 'log channels linked'); assert.strictEqual(db['1001'].logChannelId, db['1001'].trap.logChannelId, 'AntiSpam channel shared by spam + honeypot');
  const setupCh = [...gA.channels.cache.values()].find((c) => c.name.includes('𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀')); assert(setupCh.sent.length === 2, 'progress message (edited in place) + welcome: ' + setupCh.sent.length);
  assert(setupCh.sent.every((m) => (m.payload.flags & 32768) && !m.payload.content), 'announcements log is V2 only');
  console.log('A6 category/private/links/log OK');

  // ---------- B) รันซ้ำ ใช้ห้องเดิม ----------
  const before = gA.channels.cache.size; await bot.runOnboardSetup(gA, 'INV'); assert.strictEqual(gA.channels.cache.size, before, 'idempotent'); console.log('B idempotent OK');

  // ---------- C) กดตรวจแล้วผ่านทันที (เจ้าของเซิร์ฟเวอร์ ต้องสูงสุดจริง) ----------
  const gC = mkGuild('1002', { botAdmin: true, botPos: 4 }); await bot.startOnboarding(gC, { user: users.get('OWN') });
  b = mkBtn('ob_start:1002', users.get('OWN')); await bot.handleOnboardInteraction(b);
  b = mkBtn('ob_check:1002', users.get('OWN')); await bot.handleOnboardInteraction(b);
  assert((b.o.defer || b.o.update) && db['1002'].waiting !== false && !gC.channels.cache.size, 'owner needs top role (4 < STAFF 5) -> waiting');
  gC.botRole.position = 9; b = mkBtn('ob_check:1002', users.get('OWN')); await bot.handleOnboardInteraction(b);
  assert(b.o.edits && b.o.edits.length === 2 && gC.channels.cache.size === 5 && db['1002'].onboard.state === 'done', 'owner direct pass: running -> done'); console.log('C owner/top-role rule + direct confirm OK');

  // ---------- D) ออกจากเซิร์ฟเวอร์ / ยกเลิก ----------
  const gD = mkGuild('1003'); await bot.startOnboarding(gD, { user: inv });
  b = mkBtn('ob_leave:1003', inv); await bot.handleOnboardInteraction(b); assert(gD.left && db['1003'].onboard.state === 'left');
  const gE = mkGuild('1004'); await bot.startOnboarding(gE, { user: inv, skipAsk: true });
  b = mkBtn('ob_cancel:1004', inv); await bot.handleOnboardInteraction(b); assert(!gE.left && db['1004'].onboard.state === 'cancelled' && !gE.channels.cache.size); console.log('D leave/cancel OK');

  // ---------- E) DM ไม่ได้ -> ส่งในห้อง ----------
  const closed = mkUser('CLOSED', { dmFail: true });
  const gF = mkGuild('1005', { ownerId: 'CLOSED' });
  const fch = await gF.channels.create({ name: 'general', type: 0 }); gF.systemChannel = fch;
  const r = await bot.startOnboarding(gF, { user: closed });
  assert(r.sent && !r.dm && fch.sent.length === 1 && fch.sent[0].payload.allowedMentions.users[0] === 'CLOSED' && !db['1005'].onboard.dm); console.log('E DM-fail fallback OK');

  // ---------- F) แผงทั้งสามภาษา ----------
  for (const l of ['th', 'en']) { db['1001'].lang = l; bot.buildObAsk(gA); await bot.buildObPerms(gA, 'INV', true); bot.buildObDone(gA, { categoryId: cat.id, channels: { setup: 'x' }, failed: 1 }); bot.buildObLog('1001', 'INV', ['a', 'b'], false); }
  console.log(bot.tr('1001', 'obAskTitle'), '|', bot.tr('1001', 'obCheckAdmin', true), '|', bot.tr('1001', 'obStepLink', 'HoneyPot', '123'));
  db['1001'].lang = 'th'; console.log(bot.tr('1001', 'obPermsNote'), '|', bot.tr('1001', 'obStepCh', '1', 'x'));
  console.log('ALL ONBOARDING TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });