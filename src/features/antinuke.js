'use strict';
const {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { db, getCfg, save } = require('../db');
const { client } = require('../client');
const { E, em } = require('../emoji');
const { tr } = require('../i18n');
const { sendLogTo } = require('../log');
const { imgButton, imgItems, v2Line, v2Text } = require('../ui');
const { ensureLogChannels, linkLogChannels } = require('../killua-logs');
const { registerImagePanel } = require('./images');

// ---------- Anti-Nuke: กันคนลบห้อง/ลบยศ/แบน/เตะ รัวๆ (ตรวจจาก audit log) ----------
const NUKE_CMD = 'antinuke';
const WINDOW_MS = 10_000; // นับในช่วงกี่มิลลิวินาที
const LIMITS = { channel: 3, role: 3, ban: 4, kick: 4 }; // ถึงจำนวนนี้ภายในช่วงเวลา = ลงโทษ
const AUDIT = () => ({
  channel: AuditLogEvent.ChannelDelete,
  role: AuditLogEvent.RoleDelete,
  ban: AuditLogEvent.MemberBanAdd,
  kick: AuditLogEvent.MemberKick,
});

const nukeCfg = (gid) => {
  const n = (getCfg(gid).nuke ??= {});
  n.enabled ??= false;
  n.count ??= 0;
  return n;
};

const hits = new Map(); // guild:executor:type -> [{ts, label}]
const busy = new Set(); // กันลงโทษคนเดิมซ้ำ

// หาคนที่ทำจาก audit log (ต้องมีสิทธิ์ View Audit Log)
async function findExecutor(guild, type, targetId) {
  const logs = await guild.fetchAuditLogs({ type: AUDIT()[type], limit: 6 }).catch(() => null);
  if (!logs) return null;
  const e = [...logs.entries.values()].find((x) => x.targetId === targetId && Date.now() - x.createdTimestamp < 15_000);
  return e?.executor ?? null;
}

async function record(guild, type, targetId, label) {
  const n = db[guild.id]?.nuke;
  if (!n?.enabled) return;
  const ex = await findExecutor(guild, type, targetId);
  if (!ex || ex.id === client.user.id || ex.id === guild.ownerId) return; // ข้ามเจ้าของเซิร์ฟเวอร์และตัวบอทเอง

  const now = Date.now();
  const key = `${guild.id}:${ex.id}:${type}`;
  const list = (hits.get(key) ?? []).filter((h) => now - h.ts <= WINDOW_MS);
  list.push({ ts: now, label });
  hits.set(key, list);

  const bk = `${guild.id}:${ex.id}`;
  if (list.length < LIMITS[type] || busy.has(bk)) return;
  busy.add(bk);
  setTimeout(() => busy.delete(bk), 60_000);
  await punish(guild, ex, type, list);
}

async function punish(guild, ex, type, list) {
  const g = guild.id;
  const n = nukeCfg(g);
  const did = [];
  try {
    await guild.members.ban(ex.id, { reason: `Anti-Nuke: ${list.length} ${type} in ${WINDOW_MS / 1000}s`, deleteMessageSeconds: 0 });
    did.push(tr(g, 'nkDidBan'));
  } catch (err) {
    console.error('[antinuke] ban failed:', err.message);
    did.push(tr(g, 'nkDidBanFail'));
    try {
      const m = await guild.members.fetch(ex.id);
      await m.roles.set([], 'Anti-Nuke');
      did.push(tr(g, 'nkDidStrip'));
    } catch {
      did.push(tr(g, 'nkDidStripFail'));
    }
  }
  n.count += 1;
  save();

  const logCh = guild.channels.cache.get(n.logChannelId ?? getCfg(g).logs?.channels?.antinuke);
  const names = list.map((h) => `\`${String(h.label).slice(0, 40)}\``).join(' • ');
  await sendLogTo(logCh, {
    title: tr(g, 'nkLogTitle'),
    body:
      `**${tr(g, 'nkWho')}:** ${ex.username ?? ex.tag} (<@${ex.id}> • \`${ex.id}\`)\n` +
      `**${tr(g, 'nkWhat')}:** ${tr(g, 'nkAct_' + type, list.length, WINDOW_MS / 1000)}\n${names}\n\n` +
      `**${tr(g, 'nkDid')}**\n${did.map((x) => `${E.bullet} ${x}`).join('\n')}\n${E.bullet} ${tr(g, 'nkNoRestore')}`,
    source: 'AntiNuke',
    color: 0xed4245,
  });
}

function buildNukePanel(guild, note) {
  const g = guild.id;
  const n = nukeCfg(g);
  const ch = n.logChannelId ?? getCfg(g).logs?.channels?.antinuke;
  const c = new ContainerBuilder()
    .addTextDisplayComponents(v2Text(tr(g, 'nkTitle')))
    .addMediaGalleryComponents(...imgItems(g, 'nuke'))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(
        `**${tr(g, 'nkStatus')}:** ${n.enabled ? E.ok : E.warn} ${n.enabled ? tr(g, 'nkOn') : tr(g, 'nkOff')}\n` +
          `${E.bullet} **${tr(g, 'nkLimits', WINDOW_MS / 1000)}:** ${tr(g, 'nkLimitVal', LIMITS)}\n` +
          `${E.bullet} **${tr(g, 'nkPunish')}:** ${tr(g, 'nkPunishVal')}\n` +
          `${E.bullet} **${tr(g, 'nkExempt')}:** ${tr(g, 'nkExemptVal')}\n` +
          `${E.bullet} **${tr(g, 'nkLogCh')}:** ${ch ? `<#${ch}>` : `\`${tr(g, 'nkNone')}\``}\n` +
          `${E.bullet} **${tr(g, 'nkCount')}:** ${n.count}` +
          (note ? `\n\n${note}` : ''),
      ),
    )
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nuke_on').setLabel(tr(g, 'btnOn')).setEmoji(em(E.verify)).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('nuke_off').setLabel(tr(g, 'btnOff')).setEmoji(em(E.warn)).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nuke_refresh').setLabel(tr(g, 'btnRefresh')).setEmoji(em(E.refresh)).setStyle(ButtonStyle.Secondary),
        imgButton(g, 'nuke'),
      ),
    );
  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

async function enableNuke(guild) {
  const me = guild.members.me;
  const missing = me.permissions.missing([
    PermissionFlagsBits.ViewAuditLog,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageChannels,
  ]);
  if (missing.length) throw Object.assign(new Error('missing permissions'), { missing });
  const n = nukeCfg(guild.id);
  if (!guild.channels.cache.get(n.logChannelId)) {
    const made = await ensureLogChannels(guild);
    linkLogChannels(guild, made.channels);
    if (made.channels.antinuke) n.logChannelId = made.channels.antinuke.id;
  }
  n.enabled = true;
  save();
}

async function handleNukeInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  if (cmd !== NUKE_CMD && !cid.startsWith('nuke_')) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }
  if (cmd === NUKE_CMD) {
    await i.reply(buildNukePanel(i.guild));
    return true;
  }
  if (!i.isButton()) return true;

  await i.deferUpdate();
  let note = '';
  if (cid === 'nuke_on') {
    try {
      await enableNuke(i.guild);
      note = tr(g, 'nkEnabled');
    } catch (err) {
      console.error('[antinuke] enable failed:', err.message);
      note = err.missing ? tr(g, 'nkNeedPerm', err.missing.join(', ')) : tr(g, 'nkFail');
    }
  } else if (cid === 'nuke_off') {
    nukeCfg(g).enabled = false;
    save();
    note = tr(g, 'nkDisabled');
  }
  await i.editReply(buildNukePanel(i.guild, note));
  return true;
}

client.on('channelDelete', (ch) => {
  if (ch.guild) record(ch.guild, 'channel', ch.id, `#${ch.name}`).catch(console.error);
});
client.on('roleDelete', (r) => {
  record(r.guild, 'role', r.id, `@${r.name}`).catch(console.error);
});
client.on('guildBanAdd', (b) => {
  record(b.guild, 'ban', b.user.id, b.user.username ?? b.user.id).catch(console.error);
});
client.on('guildMemberRemove', (m) => {
  if (!db[m.guild.id]?.nuke?.enabled) return; // ไม่เปิดระบบ = ไม่ต้องไปดึง audit log
  record(m.guild, 'kick', m.id, m.user?.username ?? m.id).catch(console.error);
});

const commands = [
  new SlashCommandBuilder()
    .setName(NUKE_CMD)
    .setDescription('[🐧] เปิดระบบกันลบห้อง/ยศ และแบนเตะรัวๆ (Anti-Nuke)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

registerImagePanel('nuke', (i) => buildNukePanel(i.guild));

module.exports = {
  NUKE_CMD,
  LIMITS,
  WINDOW_MS,
  nukeCfg,
  record,
  punish,
  buildNukePanel,
  enableNuke,
  commands,
  handleInteraction: handleNukeInteraction,
  handleNukeInteraction,
};
