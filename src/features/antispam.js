'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  SnowflakeUtil,
  TextDisplayBuilder,
} = require('discord.js');
const { db, getCfg, save } = require('../db');
const { E, em } = require('../emoji');
const { imgButton, imgItems, modalInput, v2Text } = require('../ui');
const { tr } = require('../i18n');
const { sendLog } = require('../log');
const { client } = require('../client');
const { handleTrapMessage } = require('./trap');
const { registerImagePanel } = require('./images');

// ---------- Anti-Spam / Anti-Webhook ----------
const SPAM_CMD = 'ระบบป้องกันสแปมและwebhook';

const PUNISH_LABEL = {
  delete: '🗑️ ลบข้อความ',
  timeout: '⏳ หมดเวลา',
  kick: '👢 เตะ',
  ban: '🔨 แบน',
};

const spamCfg = (gid) =>
  (getCfg(gid).spam ??= {
    enabled: false, max: 5, sec: 5, punish: 'timeout', deleteSpam: true, warn: true, dup: false,
  });

const hookCfg = (gid) =>
  (getCfg(gid).hook ??= {
    enabled: false, max: 5, sec: 5, deleteHook: true, deleteMsgs: true, watchNew: false,
  });

const yn = (b) => (b ? 'ใช่' : 'ปิด');

const eff = (n, raid) => (raid ? Math.max(2, Math.ceil(n / 2)) : n);

// Raid Mode = เกณฑ์เข้มขึ้น 2 เท่า

function buildAntiPanel(guild, note) {
  const c = getCfg(guild.id);
  const s = spamCfg(guild.id);
  const h = hookCfg(guild.id);
  const text = (t) => new TextDisplayBuilder().setContent(t);
  const line = () =>
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## ${E.warn} Anti-Spam System\n-# ระบบป้องกันสแปมข้อความและ Webhook`))
    .addMediaGalleryComponents(...imgItems(guild.id, 'anti'))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      text(
        `### ${E.warn} Anti-Spam ข้อความ — ${s.enabled ? `${E.ok} เปิด` : `${E.warn} ปิด`}\n` +
          `${E.bullet} เกณฑ์: ส่งเกิน **${s.max}** ครั้ง ใน **${s.sec}** วิ\n` +
          `${E.bullet} บทลงโทษ: **${PUNISH_LABEL[s.punish]}**\n` +
          `${E.bullet} ลบข้อความสแปมด้วย: **${yn(s.deleteSpam)}**\n` +
          `${E.bullet} ซ้ำข้อความ (Copy-Spam): **${yn(s.dup)}**\n` +
          `${E.bullet} แจ้งเตือนในห้อง: **${yn(s.warn)}**`,
      ),
    )
    .addTextDisplayComponents(
      text(
        `### ${E.dev} Anti-Webhook Spam — ${h.enabled ? `${E.ok} เปิด` : `${E.warn} ปิด`}\n` +
          `${E.bullet} เกณฑ์: webhook ส่งเกิน **${h.max}** ครั้ง ใน **${h.sec}** วิ\n` +
          `${E.bullet} ลบ Webhook ทันที: **${yn(h.deleteHook)}**\n` +
          `${E.bullet} ลบข้อความของ Webhook ด้วย: **${yn(h.deleteMsgs)}**\n` +
          `${E.bullet} ระวัง Webhook ใหม่ถี่ผิดปกติ: **${yn(h.watchNew)}**`,
      ),
    );

  if (c.raid) {
    container.addTextDisplayComponents(text(`${E.warn} **Raid Mode เปิดอยู่** — เกณฑ์ทุกระบบเข้มขึ้น 2 เท่า`));
  }
  if (note) container.addTextDisplayComponents(text(note));

  container
    .addSeparatorComponents(line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('anti_spam_toggle')
          .setLabel(s.enabled ? 'ปิด Anti-Spam' : 'เปิด Anti-Spam')
          .setEmoji(em(s.enabled ? E.warn : E.verify))
          .setStyle(s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('anti_hook_toggle')
          .setLabel(h.enabled ? 'ปิด Anti-Webhook' : 'เปิด Anti-Webhook')
          .setEmoji(em(E.dev))
          .setStyle(h.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('anti_spam_cfg')
          .setLabel('ตั้งค่าสแปม')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('anti_hook_cfg')
          .setLabel('ตั้งค่า Webhook')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('anti_raid')
          .setLabel(c.raid ? 'ปิด Raid Mode' : 'Raid Mode')
          .setEmoji(em(E.warn))
          .setStyle(c.raid ? ButtonStyle.Danger : ButtonStyle.Primary),
        imgButton(guild.id, 'anti'),
      ),
    )
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      text(
        c.logChannelId
          ? `-# บันทึก log ที่ <#${c.logChannelId}>`
          : '-# อย่าลืมรัน /setup-log เพื่อเปิดห้อง log ด้วยนะคะ',
      ),
    );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function spamModal(guildId) {
  const s = spamCfg(guildId);
  const opts = [s.deleteSpam && 'delete_spam', s.warn && 'warn', s.dup && 'dup'].filter(Boolean).join(', ');
  return new ModalBuilder()
    .setCustomId('anti_spam_modal')
    .setTitle('ตั้งค่า Anti-Spam')
    .addComponents(
      modalInput('max', 'จำนวนข้อความสูงสุด (ก่อนนับเป็นสแปม)', s.max),
      modalInput('sec', 'ช่วงเวลา (วินาที)', s.sec),
      modalInput('punish', 'บทลงโทษ (delete / timeout / kick / ban)', s.punish),
      modalInput('opts', 'ตัวเลือก: delete_spam, warn, dup', opts, false),
    );
}

function hookModal(guildId) {
  const h = hookCfg(guildId);
  const opts = [h.deleteHook && 'delete_hook', h.deleteMsgs && 'delete_msgs', h.watchNew && 'watch_new']
    .filter(Boolean)
    .join(', ');
  return new ModalBuilder()
    .setCustomId('anti_hook_modal')
    .setTitle('ตั้งค่า Anti-Webhook')
    .addComponents(
      modalInput('max', 'จำนวนข้อความสูงสุดของ webhook', h.max),
      modalInput('sec', 'ช่วงเวลา (วินาที)', h.sec),
      modalInput('opts', 'ตัวเลือก: delete_hook, delete_msgs, watch_new', opts, false),
    );
}

const toNum = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

const toOpts = (v) => v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

async function handleAntiInteraction(i) {
  const isSpamCmd = i.isChatInputCommand() && i.commandName === SPAM_CMD;
  const isLogCmd = i.isChatInputCommand() && i.commandName === 'setup-log';
  const isOurs = (i.isButton() || i.isModalSubmit()) && i.customId.startsWith('anti_');
  if (!isSpamCmd && !isLogCmd && !isOurs) return false;
  if (!i.guild) return true;

  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(i.guild.id, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  const c = getCfg(i.guild.id);
  const s = spamCfg(i.guild.id);
  const h = hookCfg(i.guild.id);

  if (isSpamCmd) {
    await i.reply(buildAntiPanel(i.guild));
    return true;
  }

  if (isLogCmd) {
    const ch = i.options.getChannel('channel', true);
    c.logChannelId = ch.id;
    save();
    await i.reply({ content: `${E.ok} ตั้งห้อง log เป็น <#${ch.id}> แล้ว`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ----- ปุ่ม -----
  if (i.isButton()) {
    switch (i.customId) {
      case 'anti_spam_toggle':
        s.enabled = !s.enabled;
        break;
      case 'anti_hook_toggle':
        h.enabled = !h.enabled;
        break;
      case 'anti_raid':
        c.raid = !c.raid;
        if (c.raid) {
          s.enabled = true;
          h.enabled = true;
        }
        sendLog(i.guild, `${c.raid ? `${E.warn} เปิด` : `${E.ok} ปิด`} Raid Mode โดย ${i.user.tag}`);
        break;
      case 'anti_spam_cfg':
        await i.showModal(spamModal(i.guild.id));
        return true;
      case 'anti_hook_cfg':
        await i.showModal(hookModal(i.guild.id));
        return true;
      default:
        return true;
    }
    save();
    await i.update(buildAntiPanel(i.guild));
    return true;
  }

  // ----- ฟอร์มตั้งค่า -----
  if (i.isModalSubmit()) {
    const fail = (m) => i.reply({ content: `${E.warn} ${m}`, flags: MessageFlags.Ephemeral });
    const max = toNum(i.fields.getTextInputValue('max'), 2, 50);
    const sec = toNum(i.fields.getTextInputValue('sec'), 1, 120);
    if (max === null) { await fail('จำนวนข้อความต้องเป็นเลข 2-50'); return true; }
    if (sec === null) { await fail('ช่วงเวลาต้องเป็นเลข 1-120 วินาที'); return true; }
    const opts = toOpts(i.fields.getTextInputValue('opts') || '');

    if (i.customId === 'anti_spam_modal') {
      const punish = i.fields.getTextInputValue('punish').trim().toLowerCase();
      if (!PUNISH_LABEL[punish]) { await fail('บทลงโทษต้องเป็น delete / timeout / kick / ban'); return true; }
      Object.assign(s, {
        max, sec, punish,
        deleteSpam: opts.includes('delete_spam'),
        warn: opts.includes('warn'),
        dup: opts.includes('dup'),
      });
    } else {
      Object.assign(h, {
        max, sec,
        deleteHook: opts.includes('delete_hook'),
        deleteMsgs: opts.includes('delete_msgs'),
        watchNew: opts.includes('watch_new'),
      });
    }
    save();
    if (i.isFromMessage()) await i.update(buildAntiPanel(i.guild, `${E.ok} บันทึกการตั้งค่าแล้ว`));
    else await i.reply(buildAntiPanel(i.guild, `${E.ok} บันทึกการตั้งค่าแล้ว`));
    return true;
  }
  return true;
}

// ----- ตรวจจับสแปม -----
const spamTrack = new Map();

// guild:user -> [{id, channelId, ts, content}]
const hookTrack = new Map();

// webhookId -> [{id, channelId, ts}]

async function bulkDeleteGrouped(guild, entries) {
  const byChannel = new Map();
  for (const e of entries) {
    if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []);
    byChannel.get(e.channelId).push(e.id);
  }
  for (const [chId, ids] of byChannel) {
    await guild.channels.cache.get(chId)?.bulkDelete(ids, true).catch(() => {});
  }
}

async function handleSpamMessage(msg, c) {
  const s = c.spam;
  if (!s?.enabled || !msg.member) return;
  if (msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return; // ข้ามแอดมิน/ม็อด

  const now = Date.now();
  const key = `${msg.guild.id}:${msg.author.id}`;
  const list = (spamTrack.get(key) ?? []).filter((e) => now - e.ts <= s.sec * 1000);
  list.push({ id: msg.id, channelId: msg.channelId, ts: now, content: msg.content });
  spamTrack.set(key, list);

  let hit = list.length > eff(s.max, c.raid);
  if (!hit && s.dup && msg.content) {
    hit = list.filter((e) => e.content === msg.content).length >= 3;
  }
  if (!hit) return;
  spamTrack.delete(key);

  if (s.deleteSpam || s.punish === 'delete') await bulkDeleteGrouped(msg.guild, list);

  let result = 'ลบข้อความสแปม';
  try {
    if (s.punish === 'timeout') {
      await msg.member.timeout(10 * 60 * 1000, 'Anti-Spam');
      result = 'หมดเวลา 10 นาที';
    } else if (s.punish === 'kick') {
      await msg.member.kick('Anti-Spam');
      result = 'ถูกเตะออกจากเซิร์ฟเวอร์';
    } else if (s.punish === 'ban') {
      await msg.member.ban({ reason: 'Anti-Spam', deleteMessageSeconds: 0 });
      result = 'ถูกแบน';
    }
  } catch {
    result += ' (บอทไม่มีสิทธิ์ลงโทษ ตรวจสอบสิทธิ์และลำดับยศของบอท)';
  }

  if (s.warn) {
    const w = await msg.channel
      .send({
        components: [
          new ContainerBuilder()
            .setAccentColor(0xed4245)
            .addTextDisplayComponents(v2Text(`${E.warn} ${msg.author} ส่งข้อความรัวเกินกำหนด — ${result}`)),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [msg.author.id] },
      })
      .catch(() => null);
    if (w) setTimeout(() => w.delete().catch(() => {}), 8_000);
  }
  sendLog(msg.guild, `${E.warn} **Anti-Spam** | ${msg.author.tag} (${msg.author.id}) ใน <#${msg.channelId}> → ${result}`);
}

async function handleHookMessage(msg, c) {
  const h = c.hook;
  if (!h?.enabled) return;

  const now = Date.now();
  const id = msg.webhookId;
  const list = (hookTrack.get(id) ?? []).filter((e) => now - e.ts <= h.sec * 1000);
  list.push({ id: msg.id, channelId: msg.channelId, ts: now });
  hookTrack.set(id, list);

  let max = eff(h.max, c.raid);
  // Webhook ที่เพิ่งสร้างไม่ถึง 10 นาที ใช้เกณฑ์ครึ่งหนึ่ง
  if (h.watchNew && now - SnowflakeUtil.timestampFrom(id) < 10 * 60 * 1000) {
    max = Math.max(2, Math.ceil(max / 2));
  }
  if (list.length <= max) return;
  hookTrack.delete(id);

  if (h.deleteMsgs) await bulkDeleteGrouped(msg.guild, list);

  let result = 'ตรวจพบสแปม';
  if (h.deleteHook) {
    try {
      const hooks = await msg.channel.fetchWebhooks();
      const target = hooks.get(id);
      if (target) {
        await target.delete('Anti-Webhook Spam');
        result = `ลบ Webhook "${target.name}" แล้ว`;
      }
    } catch {
      result = 'ลบ Webhook ไม่ได้ (บอทต้องมีสิทธิ์ Manage Webhooks)';
    }
  }
  sendLog(msg.guild, `${E.dev} **Anti-Webhook** | webhook ${msg.author.username} (${id}) ใน <#${msg.channelId}> → ${result}`);
}

client.on('messageCreate', async (msg) => {
  try {
    if (!msg.guild) return;
    const c = db[msg.guild.id];
    if (!c) return;
    if (c.trap?.enabled && msg.channelId === c.trap.trapChannelId && !msg.webhookId && !msg.author.bot) {
      return await handleTrapMessage(msg);
    }
    if (msg.webhookId) return await handleHookMessage(msg, c);
    if (msg.author.bot) return;
    await handleSpamMessage(msg, c);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

// ล้างข้อมูลติดตามที่หมดอายุ ทุก 5 นาที
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const map of [spamTrack, hookTrack]) {
    for (const [k, v] of map) {
      if (!v.length || v[v.length - 1].ts < cutoff) map.delete(k);
    }
  }
}, 300_000);

const commands = [
  new SlashCommandBuilder()
    .setName(SPAM_CMD)
    .setDescription('ตั้งค่าระบบป้องกันสแปมข้อความและ Webhook')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('setup-log')
    .setDescription('ตั้งห้อง log สำหรับระบบป้องกันสแปม')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('ห้องที่ต้องการให้ส่ง log')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

registerImagePanel('anti', (i) => buildAntiPanel(i.guild));

module.exports = {
  buildAntiPanel,
  spamModal,
  hookModal,
  bulkDeleteGrouped,
  handleSpamMessage,
  handleHookMessage,
  SPAM_CMD,
  PUNISH_LABEL,
  spamCfg,
  hookCfg,
  yn,
  eff,
  toNum,
  toOpts,
  spamTrack,
  hookTrack,
  commands,
  handleInteraction: handleAntiInteraction,
  handleAntiInteraction,
};
