'use strict';
const {
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { getCfg } = require('../db');
const { E } = require('../emoji');
const { tr } = require('../i18n');
const { sendLogTo } = require('../log');
const { ephV2, modalInput, v2Line, v2Text } = require('../ui');

// ---------- /ประกาศ: ส่งประกาศ @everyone ไปยังห้องกลางของเซิร์ฟเวอร์ ----------
const ANN_CMD = 'ประกาศ';
const NEED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone];

function buildAnnouncement(g, userId, title, text, image) {
  const c = new ContainerBuilder()
    .setAccentColor(0xfee75c)
    .addTextDisplayComponents(v2Text('@everyone')) // ping ทุกครั้ง
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(v2Text(`## ${E.star} ${title}\n${text}`));
  if (image) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  c.addSeparatorComponents(v2Line()).addTextDisplayComponents(v2Text(`-# ${tr(g, 'annBy', userId)} • Killua Bot`));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: ['everyone'] } };
}

async function handleAnnounceInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  const isModal = i.isModalSubmit() && cid.startsWith('ann_modal:');
  if (cmd !== ANN_CMD && !isModal) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  if (!i.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
    await i.reply(ephV2(tr(g, 'annNoPerm')));
    return true;
  }

  if (cmd === ANN_CMD) {
    const target = i.options.getChannel('channel') ?? i.channel;
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`ann_modal:${target.id}`)
        .setTitle(tr(g, 'annModalTitle'))
        .addComponents(
          modalInput('title', tr(g, 'annLabelTitle'), '', true),
          modalInput('text', tr(g, 'annLabelText'), '', true, true),
          modalInput('image', tr(g, 'annLabelImage'), '', false),
        ),
    );
    return true;
  }

  // ----- ส่งประกาศจากฟอร์ม -----
  const target = i.guild.channels.cache.get(cid.split(':')[1]);
  const me = i.guild.members.me;
  if (!target?.isTextBased() || !target.permissionsFor(me)?.has(NEED) || !target.permissionsFor(i.member)?.has(NEED.slice(0, 2))) {
    await i.reply(ephV2(tr(g, 'annNeedBotPerm')));
    return true;
  }
  const title = i.fields.getTextInputValue('title').trim().slice(0, 100);
  const text = i.fields.getTextInputValue('text').trim();
  const image = (i.fields.getTextInputValue('image') || '').trim();
  if (image && !/^https?:\/\/\S+$/i.test(image)) {
    await i.reply(ephV2(tr(g, 'annBadImage')));
    return true;
  }

  try {
    const sent = await target.send(buildAnnouncement(g, i.user.id, title, text, image));
    const url = `https://discord.com/channels/${g}/${target.id}/${sent.id}`;
    await i.reply(ephV2(tr(g, 'annSent', url)));
    // log ลง Announcements ของ Killua (หมวดส่วนตัว)
    const logCh = i.guild.channels.cache.get(getCfg(g).logs?.channels?.announce);
    sendLogTo(logCh, {
      title: tr(g, 'annLogTitle'),
      body: tr(g, 'annLogBody', i.user.id, target.id, title, url),
      source: 'Announcements',
      color: 0xfee75c,
    });
  } catch (err) {
    console.error('[announce] send failed:', err.message);
    await i.reply(ephV2(tr(g, 'annFail')));
  }
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName(ANN_CMD)
    .setDescription('[🐧] ส่งประกาศไปยังส่วนกลาง @everyone ทุกครั้ง')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('ห้องที่จะประกาศ (ไม่เลือก = ห้องนี้)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .setDMPermission(false),
].map((c) => c.toJSON());

module.exports = {
  ANN_CMD,
  buildAnnouncement,
  commands,
  handleInteraction: handleAnnounceInteraction,
  handleAnnounceInteraction,
};
