'use strict';
const { ContainerBuilder, MessageFlags } = require('discord.js');
const { db } = require('./db');
const { v2Line, v2Text } = require('./ui');

// log ทุกอันของ Killua เป็น Components V2 (กล่อง + อิโมจิเซิร์ฟเวอร์ใน {ชื่อ}/E)
//   body   = ข้อความหลัก (ใส่ E.xxx ได้)    title = หัวข้อ (ไม่บังคับ)
//   source = ชื่อระบบที่ท้ายกล่อง           color = สีแถบข้าง
function logPayload({ title, body, source = 'Killua', color = 0x5865f2 }) {
  const c = new ContainerBuilder().setAccentColor(color);
  if (title) c.addTextDisplayComponents(v2Text(`## ${title}`)).addSeparatorComponents(v2Line());
  c.addTextDisplayComponents(v2Text(body));
  c.addSeparatorComponents(v2Line()).addTextDisplayComponents(v2Text(`-# Killua Bot • ${source} • <t:${Math.floor(Date.now() / 1000)}:T>`));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// ส่งเข้าห้อง log Anti-Spam / Webhook ของเซิร์ฟเวอร์
async function sendLog(guild, content) {
  const id = db[guild.id]?.logChannelId;
  const ch = id && guild.channels.cache.get(id);
  if (ch) await ch.send(logPayload({ body: content, source: 'AntiSpam', color: 0xed4245 })).catch(() => {});
}

// ส่ง log ไปห้องที่ระบุ
async function sendLogTo(channel, opts) {
  if (!channel) return null;
  return channel.send(logPayload(opts)).catch(() => null);
}

module.exports = { logPayload, sendLog, sendLogTo };
