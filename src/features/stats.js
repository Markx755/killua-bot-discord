'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { db, getCfg, save } = require('../db');
const { E, em } = require('../emoji');
const { imgButton, imgItems } = require('../ui');
const { tr } = require('../i18n');
const { client } = require('../client');
const { registerImagePanel } = require('./images');

// ---------- ระบบสถิติเซิร์ฟเวอร์ ----------
const STATS_CMD = 'สร้างระบบสถิติเซิฟเวอร์';

const STATS_INTERVAL = 10 * 60 * 1000;

// 10 นาที (กันโดน rate limit ของการเปลี่ยนชื่อห้อง)

async function collectStats(guild) {
  await guild.members.fetch();
  const humans = guild.members.cache.filter((m) => !m.user.bot);
  const online = humans.filter((m) => m.presence && m.presence.status !== 'offline').size;
  return {
    members: humans.size,
    online,
    bots: guild.members.cache.size - humans.size,
  };
}

// แผงแบบ Components V2: ไม่มีแถบสีข้าง มีเส้นคั่นบางๆ
function buildStatsPanel(guild, stats, note) {
  const s = getCfg(guild.id).stats;
  const enabled = !!s?.enabled;
  const text = (c) => new TextDisplayBuilder().setContent(c);
  const line = () =>
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## ${E.star} สถิติเซิร์ฟเวอร์`))
    .addMediaGalleryComponents(...imgItems(guild.id, 'stats'))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      text(
        `**สถานะ:** ${enabled ? `${E.ok} เปิดอยู่` : `${E.warn} ปิดอยู่`}\n` +
          `👥 **สมาชิก:** ${stats?.members ?? '-'}\n` +
          `🟢 **ออนไลน์:** ${stats?.online ?? '-'}\n` +
          `🤖 **บอท:** ${stats?.bots ?? '-'}` +
          (note ? `\n\n${note}` : ''),
      ),
    )
    .addSeparatorComponents(line());

  const statsBtns = [];
  if (enabled) {
    statsBtns.push(
      new ButtonBuilder()
        .setCustomId('stats_off')
        .setLabel('ปิดระบบ')
        .setEmoji(em(E.warn))
        .setStyle(ButtonStyle.Danger),
    );
  }
  statsBtns.push(imgButton(guild.id, 'stats'));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(...statsBtns));
  container.addSeparatorComponents(line());
  container.addTextDisplayComponents(text('-# Killua Bot • Server Stats • อัปเดตทุก 10 นาที'));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function updateStatsChannels(guild) {
  const s = getCfg(guild.id).stats;
  if (!s?.enabled) return null;
  const stats = await collectStats(guild);
  const rename = async (id, name) => {
    const ch = guild.channels.cache.get(id);
    if (ch && ch.name !== name) await ch.setName(name).catch(() => {});
  };
  await rename(s.memberCh, `👥 สมาชิก: ${stats.members}`);
  await rename(s.onlineCh, `🟢 ออนไลน์: ${stats.online}`);
  await rename(s.botCh, `🤖 บอท: ${stats.bots}`);
  return stats;
}

async function createStatsSystem(guild) {
  const cfg = getCfg(guild.id);
  const perms = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect],
    },
  ];
  const category = await guild.channels.create({
    name: '📊 SERVER STATS',
    type: ChannelType.GuildCategory,
    permissionOverwrites: perms,
    position: 0,
  });
  const mk = (name) =>
    guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: perms,
    });
  const [m, o, b] = [await mk('👥 สมาชิก: ...'), await mk('🟢 ออนไลน์: ...'), await mk('🤖 บอท: ...')];
  cfg.stats = {
    enabled: true,
    categoryId: category.id,
    memberCh: m.id,
    onlineCh: o.id,
    botCh: b.id,
  };
  save();
  return updateStatsChannels(guild);
}

async function removeStatsSystem(guild) {
  const cfg = getCfg(guild.id);
  const s = cfg.stats;
  if (s) {
    for (const id of [s.memberCh, s.onlineCh, s.botCh, s.categoryId]) {
      await guild.channels.cache.get(id)?.delete().catch(() => {});
    }
  }
  cfg.stats = { enabled: false };
  save();
}

const commands = [
  new SlashCommandBuilder()
    .setName(STATS_CMD)
    .setDescription('สร้างห้องแสดงสถิติเซิร์ฟเวอร์ (สมาชิก / ออนไลน์ / บอท)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

async function handleStatsInteraction(i) {
  if (i.isChatInputCommand() && i.commandName === STATS_CMD) {
    const cfg = getCfg(i.guild.id);
    if (cfg.stats?.enabled) {
      const stats = await collectStats(i.guild);
      await i.reply(buildStatsPanel(i.guild, stats, `${E.ok} ระบบเปิดอยู่แล้ว`));
      return true;
    }
    await i.reply({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${E.loading} กำลังสร้างห้องสถิติ...`),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    try {
      const stats = await createStatsSystem(i.guild);
      await i.editReply(buildStatsPanel(i.guild, stats, `${E.ok} เปิดระบบและสร้างห้องแล้ว`));
    } catch (err) {
      console.error(err);
      cfg.stats = { enabled: false };
      save();
      await i.editReply({
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${E.warn} สร้างห้องไม่สำเร็จ ตรวจสอบว่าบอทมีสิทธิ์ **Manage Channels**`,
            ),
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    return true;
  }

  if (i.isButton() && i.customId === 'stats_off') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({
        content: tr(i.guild.id, 'noPerm'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    await i.deferUpdate();
    await removeStatsSystem(i.guild);
    const stats = await collectStats(i.guild);
    await i.editReply(buildStatsPanel(i.guild, stats, `${E.warn} ปิดระบบและลบห้องแล้ว`));
    return true;
  }
  return false;
}

function onReady() {
  // อัปเดตสถิติทุก 10 นาที
  const refreshStats = () => {
    for (const guild of client.guilds.cache.values()) {
      if (db[guild.id]?.stats?.enabled) updateStatsChannels(guild).catch(console.error);
    }
  };
  refreshStats();
  setInterval(refreshStats, STATS_INTERVAL);
}

registerImagePanel('stats', async (i) => buildStatsPanel(i.guild, await collectStats(i.guild)));

module.exports = {
  collectStats,
  buildStatsPanel,
  updateStatsChannels,
  createStatsSystem,
  removeStatsSystem,
  STATS_CMD,
  STATS_INTERVAL,
  commands,
  handleInteraction: handleStatsInteraction,
  handleStatsInteraction,
  onReady,
};
