'use strict';
// ตรวจว่า index.js ต่อทุกระบบถูก: จำนวนคำสั่ง, ready, และ interaction ถูกส่งไปหาระบบที่ใช่
const { bot, Coll } = require('./helpers/load-bot');
const assert = require('assert');
const { client, db } = bot;

(async () => {
  let registered = null;
  client.application.commands.set = async (c) => { registered = c; };
  client.emit('ready');
  await new Promise((r) => setTimeout(r, 20));
  const names = registered.map((c) => c.name ?? 'x');
  assert.strictEqual(registered.length, 13, 'ต้องมี 13 คำสั่ง ได้ ' + registered.length);
  console.log('1 commands =', registered.length, 'OK');

  const replies = [];
  const mk = (o) => ({
    guild: { id: 'G9', channels: { cache: new Coll() }, roles: { cache: new Coll() }, members: { me: { roles: { highest: { comparePositionTo: () => 1 } } } } },
    memberPermissions: { has: () => true }, channel: { id: 'CH1' }, user: { id: '5' }, customId: undefined, replied: false, deferred: false,
    isChatInputCommand: () => !!o.cmd, isButton: () => !!o.btn, isModalSubmit: () => !!o.modal, isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false, isStringSelectMenu: () => false, isRepliable: () => true,
    commandName: o.cmd, customId: o.btn || o.modal,
    reply: async (p) => { replies.push(p); }, update: async (p) => { replies.push(p); }, showModal: async (m) => { replies.push({ modal: true }); },
    deferUpdate: async () => {}, editReply: async (p) => { replies.push(p); },
    fields: { getTextInputValue: () => 'https://example.com/a.png' }, options: { getString: () => 'en', getChannel: () => null },
  });
  const fire = async (o) => { replies.length = 0; await client.listeners('interactionCreate')[0](mk(o)); return replies.length; };

  assert(await fire({ cmd: 'botvoice' }), 'botvoice'); console.log('2 /botvoice OK');
  assert(await fire({ cmd: 'ระบบป้องกันสแปมและwebhook' }), 'anti'); console.log('3 anti OK');
  assert(await fire({ cmd: 'ระบบยืนยันตัวตน' }), 'verify'); console.log('4 verify OK');
  assert(await fire({ cmd: 'antispam' }), 'trap'); console.log('5 trap OK');
  assert(await fire({ cmd: 'บอทสร้างห้อง' }), 'create'); console.log('6 create OK');
  assert(await fire({ cmd: 'ประกาศ' }), 'announce'); console.log('6b /ประกาศ OK');
  assert(await fire({ cmd: 'antinuke' }), 'antinuke'); console.log('6c /antinuke OK');
  assert(await fire({ cmd: 'เปลี่ยนภาษาเซิฟเวอร์' }), 'lang');
  assert.strictEqual(db.G9.lang, 'en'); console.log('7 language OK');
  assert(await fire({ btn: 'img_set:voice' }), 'img_set'); console.log('8 img button OK');
  assert(await fire({ modal: 'img_modal:voice' }), 'img_modal');
  assert.strictEqual(db.G9.images.voice, 'https://example.com/a.png'); console.log('9 img modal re-renders panel OK');
  console.log('ROUTING TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
