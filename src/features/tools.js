'use strict';
const {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { tr } = require('../i18n');
const { E } = require('../emoji');
const { sendLog } = require('../log');
const { modalInput } = require('../ui');

const PURGE_CMD = 'ลบข้อความในห้องนี้';

const SAY_CMD = 'ใช้บอทส่งข้อความ';

// ---------- คำสั่งลบข้อความ / ให้บอทส่งข้อความ ----------
async function handleToolsInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  const isSayModal = i.isModalSubmit() && cid.startsWith('say_modal:');
  if (cmd !== PURGE_CMD && cmd !== SAY_CMD && !isSayModal) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await i.reply({ content: tr(g, 'noPermMsg'), flags: MessageFlags.Ephemeral });
    return true;
  }

  // ----- /ลบข้อความในห้องนี้ -----
  if (cmd === PURGE_CMD) {
    const amount = i.options.getInteger('amount', true);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const deleted = await i.channel.bulkDelete(amount, true);
      await i.editReply(deleted.size ? tr(g, 'purgeDone', deleted.size) : tr(g, 'purgeNone'));
      if (deleted.size) {
        sendLog(i.guild, `${E.warn} **Purge** | ${i.user.tag} ลบ ${deleted.size} ข้อความใน <#${i.channelId}>`);
      }
    } catch (err) {
      console.error(err);
      await i.editReply(tr(g, 'purgeFail'));
    }
    return true;
  }

  // ----- /ใช้บอทส่งข้อความ : เปิดฟอร์ม -----
  if (cmd === SAY_CMD) {
    const target = i.options.getChannel('channel') ?? i.channel;
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`say_modal:${target.id}`)
        .setTitle(tr(g, 'sayTitle'))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('text')
              .setLabel(tr(g, 'sayText'))
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(2000)
              .setRequired(true),
          ),
          modalInput('image', tr(g, 'sayImage'), '', false),
        ),
    );
    return true;
  }

  // ----- ส่งข้อความตามที่กรอกในฟอร์ม -----
  const channelId = cid.split(':')[1];
  const target = i.guild.channels.cache.get(channelId);
  const me = i.guild.members.me;
  const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  const canSend =
    target?.isTextBased() &&
    target.permissionsFor(me)?.has(need) &&
    target.permissionsFor(i.member)?.has(need);
  if (!canSend) {
    await i.reply({ content: tr(g, 'sayFail'), flags: MessageFlags.Ephemeral });
    return true;
  }

  const text = i.fields.getTextInputValue('text');
  const image = (i.fields.getTextInputValue('image') || '').trim();
  const payload = {
    content: text,
    // กันการ @everyone / @role ผ่านบอท เว้นแต่ผู้ใช้มีสิทธิ์นั้นเอง
    allowedMentions: i.memberPermissions.has(PermissionFlagsBits.MentionEveryone)
      ? { parse: ['users', 'roles', 'everyone'] }
      : { parse: ['users'] },
  };
  if (/^https?:\/\/\S+$/i.test(image)) {
    payload.embeds = [new EmbedBuilder().setColor(0x2b2d31).setImage(image)];
  }
  try {
    await target.send(payload);
    await i.reply({ content: tr(g, 'saySent', target.id), flags: MessageFlags.Ephemeral });
    sendLog(i.guild, `${E.discord} **Say** | ${i.user.tag} ใช้บอทส่งข้อความใน <#${target.id}>`);
  } catch (err) {
    console.error(err);
    await i.reply({ content: tr(g, 'sayFail'), flags: MessageFlags.Ephemeral });
  }
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName(PURGE_CMD)
    .setDescription('ลบข้อความในห้องนี้ (เลือกจำนวน 1-100)')
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('จำนวนข้อความที่จะลบ 1-100')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName(SAY_CMD)
    .setDescription('ให้บอทส่งข้อความแทนคุณ (เปิดฟอร์มให้พิมพ์ข้อความ)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('ห้องที่จะส่ง (ไม่เลือก = ห้องนี้)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),
].map((c) => c.toJSON());

module.exports = {
  PURGE_CMD,
  SAY_CMD,
  commands,
  handleInteraction: handleToolsInteraction,
  handleToolsInteraction,
};
