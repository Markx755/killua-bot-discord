'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { db, getCfg, save } = require('../db');
const { tr } = require('../i18n');
const { ephV2, imgButton, imgItems, v2Line, v2Text } = require('../ui');
const { E, em } = require('../emoji');
const { client } = require('../client');
const { registerImagePanel } = require('./images');
const { ensureLogChannels, linkLogChannels } = require('../killua-logs');

// ---------- ห้องดักสแปม (HoneyPot) ----------
const TRAP_CMD = 'antispam';

const TRAP_DAYS = 3;

// แบนกี่วัน (ปลดอัตโนมัติเมื่อครบ)
const TRAP_PURGE_SECONDS = 24 * 3600;

// ลบข้อความของคนที่โดนแบนย้อนหลังกี่วินาที (สูงสุด 7 วัน)
const TRAP_NAME = '⛔・honeypot-ห้ามพิมพ์';


const trapBusy = new Set();

// กันบอทแรดรัวข้อความหลายอันแล้วแบนซ้ำ

const trapCfg = (gid) => {
  const t = (getCfg(gid).trap ??= {});
  t.pending ??= {}; // userId -> เวลาที่ครบกำหนดแบน
  t.cases ??= {}; // messageId ในห้อง log -> ข้อมูลเคส
  t.all ??= 0;
  t.today ??= 0;
  return t;
};

const dayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

const trapCounts = (t) => ({ today: t.todayKey === dayKey() ? t.today : 0, all: t.all });

// แผงตั้งค่าสำหรับแอดมิน
function buildTrapPanel(guild, note) {
  const g = guild.id;
  const t = trapCfg(g);
  const { today, all } = trapCounts(t);
  const active = Object.keys(t.pending).length;
  const ch = (id) => (id ? `<#${id}>` : `\`${tr(g, 'trNone')}\``);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(v2Text(tr(g, 'trTitle')))
    .addMediaGalleryComponents(...imgItems(g, 'trap'))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(
        `**${tr(g, 'trStatus')}:** ${t.enabled ? E.ok : E.warn} ${t.enabled ? tr(g, 'trOnTxt') : tr(g, 'trOffTxt')}\n` +
          `${E.bullet} **${tr(g, 'trChan')}:** ${ch(t.trapChannelId)}\n` +
          `${E.bullet} **${tr(g, 'trLogCh')}:** ${ch(t.logChannelId)}\n` +
          `${E.bullet} **${tr(g, 'trPunish')}:** ${tr(g, 'trPunishVal', TRAP_DAYS)}\n` +
          `${E.bullet} **${tr(g, 'trToday')}:** ${today} • **${tr(g, 'trAll')}:** ${all} • **${tr(g, 'trActive')}:** ${active}` +
          (note ? `\n\n${note}` : ''),
      ),
    )
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('trap_on')
          .setLabel(tr(g, 'btnOn'))
          .setEmoji(em(E.verify))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('trap_off')
          .setLabel(tr(g, 'btnOff'))
          .setEmoji(em(E.warn))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('trap_refresh')
          .setLabel(tr(g, 'btnRefresh'))
          .setEmoji(em(E.refresh))
          .setStyle(ButtonStyle.Secondary),
        imgButton(g, 'trap'),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ข้อความเตือนที่โพสต์ในห้องดัก
function buildTrapMessage(guild) {
  const g = guild.id;
  const t = trapCfg(g);
  const { today, all } = trapCounts(t);
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(v2Text(`## ${tr(g, 'trHead')}\n${tr(g, 'trBody', TRAP_DAYS)}`))
    .addMediaGalleryComponents(...imgItems(g, 'trap'))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(`\`\`\`\n• ${tr(g, 'trToday')}: ${today}\n• ${tr(g, 'trAll')}: ${all}\n\`\`\``),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('trap_why')
          .setLabel(tr(g, 'trWhyBtn'))
          .setEmoji(em(E.info))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function refreshTrapMessage(guild) {
  const t = db[guild.id]?.trap;
  if (!t?.trapChannelId || !t.trapMsgId) return;
  const ch = guild.channels.cache.get(t.trapChannelId);
  const msg = await ch?.messages.fetch(t.trapMsgId).catch(() => null);
  if (msg) await msg.edit(buildTrapMessage(guild)).catch(() => {});
}

// ข้อความแจ้งใน log (status: banned | unbanned | ignored | expired | failed)
function buildTrapLog(g, cs, status, by) {
  const until = Math.floor(cs.until / 1000);
  const statusLine = {
    banned: tr(g, 'lgBanned', until),
    unbanned: tr(g, 'lgUnbanned', by),
    ignored: tr(g, 'lgIgnored', by),
    expired: tr(g, 'lgExpired'),
    failed: tr(g, 'lgFailed'),
  }[status];

  const did = [tr(g, 'lgActDel')];
  if (status !== 'failed') did.push(tr(g, 'lgActBan', TRAP_DAYS));
  if (status === 'banned') did.push(tr(g, 'lgActSched', until));
  const container = new ContainerBuilder()
    .setAccentColor(status === 'banned' || status === 'failed' ? 0xed4245 : 0x57f287)
    .addTextDisplayComponents(v2Text(`## ${tr(g, 'lgTitle')}`))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(
        `**${tr(g, 'lgUser')}:** ${cs.tag} (<@${cs.uid}> • \`${cs.uid}\`)\n` +
          `**${tr(g, 'lgChannel')}:** <#${cs.channelId}>\n` +
          `**${tr(g, 'lgMsg')}:**\n\`\`\`\n${cs.content}\n\`\`\`\n${statusLine}`,
      ),
    )
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(v2Text(`**${tr(g, 'lgDid')}**\n${did.map((x) => `${E.bullet} ${x}`).join('\n')}\n\n-# Killua Bot • AntiSpam`));
  if (status === 'banned') {
    container.addSeparatorComponents(v2Line()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trap_unban:${cs.uid}`)
          .setLabel(tr(g, 'btnUnban'))
          .setEmoji(em(E.verify))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`trap_ignore:${cs.uid}`)
          .setLabel(tr(g, 'btnIgnore'))
          .setEmoji(em(E.dots))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// เปิดระบบ: สร้างห้องดักไว้บนสุด + ห้อง log (เห็นเฉพาะทีมงาน)
async function enableTrap(guild) {
  const t = trapCfg(guild.id);
  const me = guild.members.me;
  const need = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
  ];
  const missing = me.permissions.missing(need);
  if (missing.length) throw Object.assign(new Error('missing permissions'), { missing });

  const everyone = guild.roles.everyone.id;
  const botAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
  ];

  let trapCh = t.trapChannelId && guild.channels.cache.get(t.trapChannelId);
  if (!trapCh) {
    trapCh = await guild.channels.create({
      name: TRAP_NAME,
      type: ChannelType.GuildText,
      topic: `Do not post here / ห้ามพิมพ์ในห้องนี้ — ข้อความจะถูกลบและแบน ${TRAP_DAYS} วันทันที`,
      position: 0,
      permissionOverwrites: [
        {
          id: everyone,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        { id: me.id, allow: botAllow },
      ],
    });
    await trapCh.setPosition(0).catch(() => {});
    t.trapChannelId = trapCh.id;
    t.trapMsgId = null;
  }

  // ห้อง log = ห้อง AntiSpam ในหมวดส่วนตัว 𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀 (เห็นเฉพาะ Killua + เจ้าของเซิร์ฟเวอร์)
  let logCh = t.logChannelId && guild.channels.cache.get(t.logChannelId);
  if (!logCh) {
    const made = await ensureLogChannels(guild);
    linkLogChannels(guild, made.channels);
    logCh = made.channels.antispam;
    if (!logCh) throw new Error('cannot create log channel');
    t.logChannelId = logCh.id;
  }

  t.enabled = true;
  const old = t.trapMsgId ? await trapCh.messages.fetch(t.trapMsgId).catch(() => null) : null;
  if (old) await old.edit(buildTrapMessage(guild));
  else t.trapMsgId = (await trapCh.send(buildTrapMessage(guild))).id;
  save();
}

// ปิดระบบ: ลบห้องดัก (ห้อง log เก็บไว้ และคนที่ถูกแบนยังถูกปลดตามเวลา)
async function disableTrap(guild) {
  const t = trapCfg(guild.id);
  t.enabled = false;
  if (t.trapChannelId) await guild.channels.cache.get(t.trapChannelId)?.delete().catch(() => {});
  t.trapChannelId = null;
  t.trapMsgId = null;
  save();
}

// มีคนพิมพ์ในห้องดัก -> ลบข้อความ + แบน + แจ้ง log
async function handleTrapMessage(msg) {
  const guild = msg.guild;
  const uid = msg.author.id;
  if (msg.system || uid === client.user.id || uid === guild.ownerId) return;

  // ทีมงานพิมพ์ในห้องนี้ได้ ไม่โดนแบน
  const member = msg.member ?? (await guild.members.fetch(uid).catch(() => null));
  if (
    member?.permissions.has([PermissionFlagsBits.Administrator], true) ||
    member?.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member?.permissions.has(PermissionFlagsBits.BanMembers) ||
    member?.permissions.has(PermissionFlagsBits.ManageMessages)
  ) {
    return;
  }

  const key = `${guild.id}:${uid}`;
  if (trapBusy.has(key)) {
    msg.delete().catch(() => {});
    return;
  }
  trapBusy.add(key);
  setTimeout(() => trapBusy.delete(key), 15_000);

  const t = trapCfg(guild.id);
  const content = (msg.content || (msg.attachments.size ? '[attachment / ไฟล์แนบ]' : '[empty / ไม่มีข้อความ]'))
    .slice(0, 300)
    .replace(/```/g, "'''");
  await msg.delete().catch(() => {});

  const cs = {
    uid,
    tag: msg.author.username,
    channelId: msg.channelId,
    content,
    until: Date.now() + TRAP_DAYS * 86_400_000,
    status: 'banned',
  };
  try {
    await guild.members.ban(uid, {
      reason: `Honeypot trap: posted in trap channel (${TRAP_DAYS} days)`,
      deleteMessageSeconds: TRAP_PURGE_SECONDS,
    });
    t.pending[uid] = cs.until;
    t.all += 1;
    const k = dayKey();
    if (t.todayKey !== k) {
      t.todayKey = k;
      t.today = 0;
    }
    t.today += 1;
    save();
    refreshTrapMessage(guild).catch(() => {});
  } catch (err) {
    console.error('[trap] ban failed:', err.message);
    cs.status = 'failed';
  }

  const logCh = t.logChannelId && guild.channels.cache.get(t.logChannelId);
  if (logCh) {
    const sent = await logCh
      .send({ ...buildTrapLog(guild.id, cs, cs.status), allowedMentions: { parse: [] } })
      .catch(() => null);
    if (sent) {
      t.cases[sent.id] = cs;
      const ids = Object.keys(t.cases);
      for (const id of ids.slice(0, Math.max(0, ids.length - 50))) delete t.cases[id]; // เก็บ 50 เคสล่าสุด
      save();
    }
  }
}

// ปลดแบนอัตโนมัติเมื่อครบกำหนด (เช็คทุก 1 นาที และตอนบอทเริ่มทำงาน)
let trapUnbanRunning = false;

async function processTrapUnbans() {
  if (trapUnbanRunning) return;
  trapUnbanRunning = true;
  try {
    const now = Date.now();
    for (const [gid, c] of Object.entries(db)) {
      const pending = c.trap?.pending;
      const guild = client.guilds.cache.get(gid);
      if (!pending || !guild) continue;
      for (const [uid, at] of Object.entries(pending)) {
        if (at > now) continue;
        try {
          await guild.members.unban(uid, `Honeypot: ครบกำหนดแบน ${TRAP_DAYS} วัน`);
        } catch (e) {
          if (e.code !== 10026) {
            console.error('[trap] unban failed:', e.message); // 10026 = ไม่ได้ถูกแบนอยู่แล้ว ถือว่าเสร็จ
            continue;
          }
        }
        delete pending[uid];
        save();
        // อัปเดตข้อความเคสใน log ให้เป็น "ครบกำหนด"
        for (const [mid, cs] of Object.entries(c.trap.cases)) {
          if (cs.uid !== uid || !['banned', 'ignored'].includes(cs.status)) continue;
          cs.status = 'expired';
          const logCh = guild.channels.cache.get(c.trap.logChannelId);
          const m = await logCh?.messages.fetch(mid).catch(() => null);
          if (m) await m.edit({ ...buildTrapLog(gid, cs, 'expired'), allowedMentions: { parse: [] } }).catch(() => {});
        }
        save();
      }
    }
  } finally {
    trapUnbanRunning = false;
  }
}

async function handleTrapInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  if (cmd !== TRAP_CMD && !cid.startsWith('trap_')) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  const t = trapCfg(g);

  // ปุ่ม "ทำไมมีห้องนี้?" ในห้องดัก (ทุกคนกดได้)
  if (cid === 'trap_why') {
    await i.reply(ephV2(tr(g, 'trWhy', TRAP_DAYS)));
    return true;
  }

  // ปุ่มปลดแบน / เพิกเฉย ในห้อง log
  if (i.isButton() && /^trap_(unban|ignore):\d+$/.test(cid)) {
    const [action, uid] = cid.slice(5).split(':');
    if (
      !i.memberPermissions?.has(PermissionFlagsBits.BanMembers) &&
      !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await i.reply({ content: tr(g, 'noPermBan'), flags: MessageFlags.Ephemeral });
      return true;
    }
    await i.deferUpdate();
    const cs =
      t.cases[i.message.id] ??
      { uid, tag: uid, channelId: t.trapChannelId ?? i.channelId, content: '-', until: t.pending[uid] ?? Date.now() };

    if (action === 'unban') {
      try {
        await i.guild.members.unban(uid, `Honeypot: ปลดแบนโดย ${i.user.tag}`);
      } catch (e) {
        if (e.code !== 10026) {
          await i.followUp({ content: tr(g, 'unbanFail'), flags: MessageFlags.Ephemeral });
          return true;
        }
      }
      delete t.pending[uid];
      cs.status = 'unbanned';
    } else {
      cs.status = 'ignored';
    }
    if (t.cases[i.message.id]) t.cases[i.message.id] = cs;
    save();
    await i.editReply({ ...buildTrapLog(g, cs, cs.status, `<@${i.user.id}>`), allowedMentions: { parse: [] } });
    return true;
  }

  // ต่อจากนี้ต้องเป็นแอดมิน
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (cmd === TRAP_CMD) {
    await i.reply(buildTrapPanel(i.guild));
    return true;
  }

  if (!i.isButton()) return true;
  await i.deferUpdate();
  let note = '';
  if (cid === 'trap_on') {
    try {
      await enableTrap(i.guild);
      note = tr(g, 'trCreated', t.trapChannelId, t.logChannelId);
    } catch (err) {
      console.error('[trap] enable failed:', err.message);
      note = err.missing ? tr(g, 'trNeedPerm', err.missing.join(', ')) : tr(g, 'trFail');
    }
  } else if (cid === 'trap_off') {
    await disableTrap(i.guild);
    note = tr(g, 'trClosed');
  }
  await i.editReply(buildTrapPanel(i.guild, note));
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName(TRAP_CMD)
    .setDescription('[🐧] เปิดระบบดักบอทสแปม')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

function onReady() {
  processTrapUnbans().catch(console.error);
  setInterval(() => processTrapUnbans().catch(console.error), 60_000);
}

registerImagePanel('trap', (i) => buildTrapPanel(i.guild), (guild) => refreshTrapMessage(guild));

module.exports = {
  buildTrapPanel,
  buildTrapMessage,
  refreshTrapMessage,
  buildTrapLog,
  enableTrap,
  disableTrap,
  handleTrapMessage,
  processTrapUnbans,
  TRAP_CMD,
  TRAP_DAYS,
  TRAP_PURGE_SECONDS,
  TRAP_NAME,
  trapBusy,
  trapCfg,
  dayKey,
  trapCounts,
  trapUnbanRunning,
  commands,
  handleInteraction: handleTrapInteraction,
  handleTrapInteraction,
  onReady,
};
