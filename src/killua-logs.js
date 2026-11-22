'use strict';
/*
 * หมวดหมู่ log ส่วนตัวของ Killua (เห็นเฉพาะ Killua + เจ้าของเซิร์ฟเวอร์)
 *   𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀
 *   ╭・𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀   บันทึกการตั้งค่า + ประกาศที่ Killua ส่ง
 *   ︱・𝗔𝗻𝘁𝗶𝗦𝗽𝗮𝗺         HoneyPot / Anti-Spam / Anti-Webhook
 *   ︱・𝗔𝗻𝘁𝗶𝗡𝘂𝗸𝗲         Anti-Nuke
 *   ╰・𝗝𝗼𝗶𝗻𝗚𝗮𝘁𝗲         การยืนยันตัวตน
 * ทั้ง onboarding และ /antispam ใช้ตัวเดียวกันนี้ (สร้างครั้งเดียว ใช้ซ้ำ ไม่สร้างซ้ำ)
 */
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getCfg, save } = require('./db');

const LOG_CATEGORY = '𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀';
const LOG_CHANNELS = [
  { key: 'announce', name: '╭・𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀' },
  { key: 'antispam', name: '︱・𝗔𝗻𝘁𝗶𝗦𝗽𝗮𝗺' },
  { key: 'antinuke', name: '︱・𝗔𝗻𝘁𝗶𝗡𝘂𝗸𝗲' },
  { key: 'joingate', name: '╰・𝗝𝗼𝗶𝗻𝗚𝗮𝘁𝗲' },
];

const locks = new Map(); // guild -> promise (กันสร้างซ้ำถ้าเรียกพร้อมกัน)

function ensureLogChannels(guild, onStep) {
  const prev = locks.get(guild.id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doEnsure(guild, onStep));
  locks.set(guild.id, run);
  return run;
}

// onStep({kind:'category'|'channel'|'fail', created, channel, key, name}) เรียกทุกขั้น เพื่อให้ผู้เรียกบันทึกว่าทำอะไรไป
async function doEnsure(guild, onStep = async () => {}) {
  const cfg = getCfg(guild.id);
  const logs = (cfg.logs ??= { categoryId: null, channels: {} });
  logs.channels ??= {};
  const me = guild.members.me;
  const exists = (id) => (id ? guild.channels.cache.get(id) : null);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
  // ส่วนตัว: เฉพาะ Killua + เจ้าของเซิร์ฟเวอร์
  if (guild.ownerId && guild.ownerId !== me.id && (await guild.members.fetch(guild.ownerId).catch(() => null))) {
    overwrites.push({ id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
  }

  const res = { category: null, channels: {}, failed: 0 };

  let cat = exists(logs.categoryId);
  try {
    const created = !cat;
    if (!cat) {
      cat = await guild.channels.create({ name: LOG_CATEGORY, type: ChannelType.GuildCategory, permissionOverwrites: overwrites });
      logs.categoryId = cat.id;
    }
    res.category = cat;
    await onStep({ kind: 'category', created, channel: cat });
  } catch (err) {
    console.error('[logs] create category failed:', err.message);
    res.failed += 1;
    cat = null;
  }

  for (const def of LOG_CHANNELS) {
    try {
      let ch = exists(logs.channels[def.key]);
      const created = !ch;
      if (!ch) {
        ch = await guild.channels.create({
          name: def.name,
          type: ChannelType.GuildText,
          parent: cat?.id,
          permissionOverwrites: overwrites,
        });
        logs.channels[def.key] = ch.id;
      }
      res.channels[def.key] = ch;
      await onStep({ kind: 'channel', key: def.key, created, channel: ch });
    } catch (err) {
      console.error(`[logs] create ${def.key} failed:`, err.message);
      res.failed += 1;
      await onStep({ kind: 'fail', key: def.key, name: def.name });
    }
  }
  save();
  return res;
}

// ผูกห้อง log เข้ากับแต่ละระบบ (ไม่ทับที่ตั้งไว้เองและยังใช้ได้อยู่) คืนรายการที่ทำไป
function linkLogChannels(guild, channels) {
  const cfg = getCfg(guild.id);
  const exists = (id) => (id ? guild.channels.cache.get(id) : null);
  const out = [];
  const link = (sys, key, get, set) => {
    const ch = channels[key];
    if (!ch) return;
    if (exists(get())) out.push({ sys, kept: true });
    else {
      set(ch.id);
      out.push({ sys, id: ch.id });
    }
  };
  link('Anti-Spam / Anti-Webhook', 'antispam', () => cfg.logChannelId, (id) => (cfg.logChannelId = id));
  link('HoneyPot', 'antispam', () => (cfg.trap ??= {}).logChannelId, (id) => ((cfg.trap ??= {}).logChannelId = id));
  link('Anti-Nuke', 'antinuke', () => (cfg.nuke ??= {}).logChannelId, (id) => ((cfg.nuke ??= {}).logChannelId = id));
  link('JoinGate', 'joingate', () => (cfg.verify ??= {}).logChannelId, (id) => ((cfg.verify ??= {}).logChannelId = id));
  save();
  return out;
}

module.exports = { LOG_CATEGORY, LOG_CHANNELS, ensureLogChannels, linkLogChannels };
