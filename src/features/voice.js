'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} = require('@discordjs/voice');
const { db, getCfg, save } = require('../db');
const { E, em } = require('../emoji');
const { imgButton, imgItems } = require('../ui');
const { BOT_NAME } = require('../config');
const { client } = require('../client');
const { tr } = require('../i18n');
const { registerImagePanel } = require('./images');

// ---------- UI ----------
function buildPanel(guild) {
  const cfg = getCfg(guild.id);
  const channelText = cfg.channelId ? `<#${cfg.channelId}>` : '`ยังไม่ได้เลือก`';


  const select = new ChannelSelectMenuBuilder()
    .setCustomId('voice247_select')
    .setPlaceholder('เลือกห้องเสียง')
    .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg.channelId) select.setDefaultChannels(cfg.channelId);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('voice247_on')
      .setLabel('เปิดระบบ')
      .setEmoji(em(E.verify))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('voice247_off')
      .setLabel('ปิดระบบ')
      .setEmoji(em(E.warn))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('voice247_refresh')
      .setLabel('รีเฟรช')
      .setEmoji(em(E.refresh))
      .setStyle(ButtonStyle.Secondary),
    imgButton(guild.id, 'voice'),
  );

  const text = (c) => new TextDisplayBuilder().setContent(c);
  const line = () =>
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## ${E.ring} ระบบ Voice 24/7 — ${BOT_NAME.toUpperCase()}`))
    .addMediaGalleryComponents(...imgItems(guild.id, 'voice'))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      text(
        `> ${E.game} **ห้องเสียง:** ${channelText}\n` +
          `> ${cfg.enabled ? E.ok : E.warn} **สถานะ:** ${cfg.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`,
      ),
    )
    .addSeparatorComponents(line())
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addActionRowComponents(buttons)
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text(`-# ${BOT_NAME} · Voice 24/7`));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ---------- ระบบเข้าห้องเสียง ----------
const voiceBusy = new Set();

// guild ที่กำลังต่ออยู่ กันเรียกซ้อนจนเข้าออกวน
const voiceNextTry = new Map();

// guild -> เวลาที่ลองใหม่ได้ (หน่วงเมื่อเข้าไม่สำเร็จ)
const voiceFails = new Map();

// guild -> จำนวนครั้งที่ล้มเหลวติดกัน
const VOICE_DEBUG = process.env.DEBUG_VOICE === '1';

async function connect(guildId, force = false) {
  const cfg = getCfg(guildId);
  if (!cfg.enabled || !cfg.channelId) return false;
  if (force) {
    voiceNextTry.delete(guildId);
    voiceFails.delete(guildId);
  }
  if (voiceBusy.has(guildId)) return false;
  if ((voiceNextTry.get(guildId) ?? 0) > Date.now()) return false;

  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(cfg.channelId);
  if (!channel) return false;

  const existing = getVoiceConnection(guildId);
  if (
    existing &&
    existing.joinConfig.channelId === cfg.channelId &&
    existing.state.status !== VoiceConnectionStatus.Destroyed &&
    existing.state.status !== VoiceConnectionStatus.Disconnected
  ) {
    return true;
  }

  voiceBusy.add(guildId);
  try {
    existing?.destroy();

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    connection.on('error', (e) => console.error(`[voice ${guildId}] error:`, e.message));
    if (VOICE_DEBUG) {
      connection.on('stateChange', (o, n) =>
        console.log(`[voice ${guildId}] ${o.status} -> ${n.status}`, n.closeCode ?? ''),
      );
    }

    // ถูกย้าย/หลุดชั่วคราว: รอ 5 วิให้ต่อใหม่เอง ถ้าไม่ได้ค่อยทำลาย แล้วให้ตัวเช็คทุก 30 วิดึงกลับ
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    voiceFails.delete(guildId);
    voiceNextTry.delete(guildId);
    return true;
  } catch (err) {
    getVoiceConnection(guildId)?.destroy();
    const n = (voiceFails.get(guildId) ?? 0) + 1;
    voiceFails.set(guildId, n);
    const wait = Math.min(5 * 60_000, 10_000 * 2 ** (n - 1)); // 10s, 20s, 40s ... สูงสุด 5 นาที
    voiceNextTry.set(guildId, Date.now() + wait);
    console.error(`[voice ${guildId}] เข้าห้องไม่สำเร็จ (ครั้งที่ ${n}) จะลองใหม่ใน ${wait / 1000} วิ`);
    return false;
  } finally {
    voiceBusy.delete(guildId);
  }
}

function disconnect(guildId) {
  voiceNextTry.delete(guildId);
  voiceFails.delete(guildId);
  getVoiceConnection(guildId)?.destroy();
}

const commands = [
  new SlashCommandBuilder()
    .setName('botvoice')
    .setDescription('ตั้งค่าระบบ Voice 24/7 (บอทค้างห้องเสียงตลอดเวลา)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

async function handleVoiceInteraction(i) {
  if (i.isChatInputCommand() && i.commandName === 'botvoice') {
    await i.reply(buildPanel(i.guild));
    return true;
  }

  const isOurs = (i.isButton() || i.isChannelSelectMenu()) && i.customId.startsWith('voice247_');
  if (!isOurs) return false;

  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({
      content: tr(i.guild.id, 'noPerm'),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const cfg = getCfg(i.guild.id);

  if (i.isChannelSelectMenu()) {
    cfg.channelId = i.values[0];
    save();
    await i.update(buildPanel(i.guild));
    if (cfg.enabled) connect(i.guild.id, true).catch(console.error);
    return true;
  }

  switch (i.customId) {
    case 'voice247_on': {
      if (!cfg.channelId) {
        await i.reply({
          content: `${E.warn} กรุณาเลือกห้องเสียงก่อน`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      cfg.enabled = true;
      save();
      await i.update(buildPanel(i.guild));
      connect(i.guild.id, true).catch(console.error);
      break;
    }
    case 'voice247_off': {
      cfg.enabled = false;
      save();
      disconnect(i.guild.id);
      await i.update(buildPanel(i.guild));
      break;
    }
    case 'voice247_refresh': {
      await i.update(buildPanel(i.guild));
      if (cfg.enabled) connect(i.guild.id, true).catch(console.error);
      break;
    }
  }
  return true;
}

// ถ้าบอทโดนเตะ/ย้าย ให้กลับเข้าห้องที่ตั้งไว้
client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.id !== client.user.id) return;
  const cfg = db[newState.guild.id];
  if (cfg?.enabled && newState.channelId !== cfg.channelId) {
    setTimeout(() => connect(newState.guild.id).catch(() => {}), 2_000);
  }
});

function onReady() {
  // เข้าห้องที่เปิดระบบไว้
  for (const guildId of Object.keys(db)) {
    if (db[guildId].enabled) connect(guildId).catch(console.error);
  }
  // เช็คทุก 30 วินาที ถ้าหลุดให้กลับเข้า
  setInterval(() => {
    for (const guildId of Object.keys(db)) {
      if (db[guildId].enabled) connect(guildId).catch(() => {});
    }
  }, 30_000);
}

registerImagePanel('voice', (i) => buildPanel(i.guild));

module.exports = {
  buildPanel,
  connect,
  disconnect,
  voiceBusy,
  voiceNextTry,
  voiceFails,
  VOICE_DEBUG,
  commands,
  handleInteraction: handleVoiceInteraction,
  handleVoiceInteraction,
  onReady,
};
