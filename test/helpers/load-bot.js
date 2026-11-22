'use strict';
/*
 * โหลดบอททั้งตัวโดยใช้ discord.js ปลอม (ไม่ต่อเน็ต ไม่ต้องมี token ไม่ต้อง npm install)
 * ใช้ในเทสต์: const { bot, users, Coll } = require('./helpers/load-bot');
 *   bot = รวมทุกอย่างที่ src/* export (เช่น bot.enableTrap, bot.tr, bot.client, bot.db)
 */
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const users = new Map();
// builder ปลอม: จดทุกการเรียก (setContent(...), addTextDisplayComponents(...) ฯลฯ) ไว้ เพื่อให้เทสต์ JSON.stringify แล้วอ่านข้อความในแผงได้
const mkB = () => {
  const d = {};
  const p = new Proxy({}, {
    get: (t, k) => (k === 'then' ? undefined : k === 'toJSON' ? () => d : (...a) => { (d[k] ??= []).push(a); return p; }),
  });
  return p;
};
class B { constructor() { return mkB(); } }
const enumProxy = () => new Proxy({}, { get: (t, k) => (typeof k === 'string' ? k : undefined) });
class Coll extends Map {
  some(f) { for (const v of this.values()) if (f(v)) return true; return false; }
  find(f) { for (const v of this.values()) if (f(v)) return v; }
  filter(f) { const c = new Coll(); for (const [k, v] of this) if (f(v)) c.set(k, v); return c; }
}
class Client extends EventEmitter {
  constructor() {
    super();
    this.user = { id: 'BOT', setPresence() {} };
    this.guilds = { cache: new Coll() };
    this.users = { fetch: async (id) => users.get(id) || null };
    this.application = { commands: { set: async () => {} } };
  }
  login() {}
}
const mocks = {
  'discord.js': new Proxy({
    Client, GatewayIntentBits: enumProxy(), ButtonStyle: enumProxy(),
    ChannelType: { GuildText: 0, GuildVoice: 2, GuildCategory: 4, GuildStageVoice: 13, GuildAnnouncement: 5 },
    PermissionFlagsBits: enumProxy(), MessageFlags: { IsComponentsV2: 32768, Ephemeral: 64 },
    SeparatorSpacingSize: enumProxy(), TextInputStyle: enumProxy(), SnowflakeUtil: {}, AuditLogEvent: { BotAdd: 28, ChannelDelete: 12, RoleDelete: 32, MemberBanAdd: 22, MemberKick: 20 },
  }, { get: (t, k) => (k in t ? t[k] : B) }),
  '@discordjs/voice': { joinVoiceChannel() {}, getVoiceConnection() {}, VoiceConnectionStatus: enumProxy(), entersState() {} },
  dotenv: { config() {} },
};
const orig = Module._load;
Module._load = function (r, ...a) { return mocks[r] ?? orig.call(this, r, ...a); };

// ฐานข้อมูลชั่วคราว ใหม่ทุกครั้งที่รัน (ไม่แตะ data.json จริง)
process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'killua-test-')), 'data.json');

const root = path.join(__dirname, '..', '..');
require(path.join(root, 'index.js'));
const bot = {};
const srcDir = path.join(root, 'src');
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== 'texts') walk(p); } else if (f.name.endsWith('.js')) Object.assign(bot, require(p));
  }
};
walk(srcDir);

module.exports = { bot, users, Coll };
