'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { tr } = require('../i18n');
const { imgButton, imgItems, modalInput, v2Line, v2Text } = require('../ui');
const { E, em } = require('../emoji');
const { sendLog } = require('../log');
const { registerImagePanel } = require('./images');

// ---------- บอทสร้างห้อง (ห้องข้อความ / ห้องเสียง / หมวดหมู่) ----------
const CREATE_CMD = 'บอทสร้างห้อง';

const createState = new Map();

// guild:user -> categoryId ที่เลือกไว้

function buildCreatePanel(guild, userId, note) {
  const g = guild.id;
  const catId = createState.get(`${g}:${userId}`);

  const catSelect = new ChannelSelectMenuBuilder()
    .setCustomId('create_cat')
    .setPlaceholder(tr(g, 'phCat'))
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(1)
    .setMaxValues(1);
  if (catId) catSelect.setDefaultChannels(catId);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      v2Text(
        `${tr(g, 'crTitle')}\n\n**${tr(g, 'crCatLine')}:** ${catId ? `<#${catId}>` : tr(g, 'crNoCat')}` +
          (note ? `\n\n${note}` : ''),
      ),
    )
    .addMediaGalleryComponents(...imgItems(g, 'create'))
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(new ActionRowBuilder().addComponents(catSelect))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('create_text')
          .setLabel(tr(g, 'btnText'))
          .setEmoji('💬')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('create_voice')
          .setLabel(tr(g, 'btnVoice'))
          .setEmoji(em(E.game))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('create_category')
          .setLabel(tr(g, 'btnCategory'))
          .setEmoji('📁')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('create_clear')
          .setLabel(tr(g, 'btnClearCat'))
          .setEmoji('🧹')
          .setStyle(ButtonStyle.Secondary),
        imgButton(g, 'create'),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function handleCreateInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  if (cmd !== CREATE_CMD && !cid.startsWith('create_')) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await i.reply({ content: tr(g, 'noPermCh'), flags: MessageFlags.Ephemeral });
    return true;
  }
  const key = `${g}:${i.user.id}`;

  if (cmd === CREATE_CMD) {
    const panel = buildCreatePanel(i.guild, i.user.id);
    await i.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
    return true;
  }

  if (i.isChannelSelectMenu() && cid === 'create_cat') {
    createState.set(key, i.values[0]);
    await i.update(buildCreatePanel(i.guild, i.user.id));
    return true;
  }
  if (i.isButton() && cid === 'create_clear') {
    createState.delete(key);
    await i.update(buildCreatePanel(i.guild, i.user.id));
    return true;
  }

  // ปุ่มเลือกชนิดห้อง -> เปิดฟอร์มกรอกชื่อ
  if (i.isButton() && ['create_text', 'create_voice', 'create_category'].includes(cid)) {
    const kind = cid.replace('create_', '');
    const modal = new ModalBuilder()
      .setCustomId(`create_modal:${kind}`)
      .setTitle(tr(g, kind === 'text' ? 'crModalText' : kind === 'voice' ? 'crModalVoice' : 'crModalCat'))
      .addComponents(modalInput('name', tr(g, kind === 'category' ? 'crCatNameLabel' : 'crNameLabel'), '', true));
    if (kind === 'text') modal.addComponents(modalInput('extra', tr(g, 'crTopicLabel'), '', false));
    if (kind === 'voice') modal.addComponents(modalInput('extra', tr(g, 'crLimitLabel'), '', false));
    await i.showModal(modal);
    return true;
  }

  // ฟอร์มส่งกลับ -> สร้างห้อง
  if (i.isModalSubmit() && cid.startsWith('create_modal:')) {
    const kind = cid.split(':')[1];
    const name = i.fields.getTextInputValue('name').trim().slice(0, 100);
    const extra = (kind === 'category' ? '' : i.fields.getTextInputValue('extra') || '').trim();
    if (!name) {
      await i.reply({ content: tr(g, 'crFail'), flags: MessageFlags.Ephemeral });
      return true;
    }

    const parentId = createState.get(key);
    const parent = parentId && i.guild.channels.cache.get(parentId)?.type === ChannelType.GuildCategory ? parentId : undefined;

    try {
      let created;
      if (kind === 'category') {
        created = await i.guild.channels.create({ name, type: ChannelType.GuildCategory });
      } else if (kind === 'voice') {
        const limit = Math.min(99, Math.max(0, parseInt(extra, 10) || 0));
        created = await i.guild.channels.create({ name, type: ChannelType.GuildVoice, parent, userLimit: limit });
      } else {
        created = await i.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent,
          topic: extra || undefined,
        });
      }
      await i.reply({
        content: kind === 'category' ? tr(g, 'crDoneCat', created.name) : tr(g, 'crDone', created.id),
        flags: MessageFlags.Ephemeral,
      });
      sendLog(i.guild, `${E.blocks} **Create** | ${i.user.tag} สร้าง ${kind} "${created.name}"`);
    } catch (err) {
      console.error(err);
      await i.reply({ content: tr(g, 'crFail'), flags: MessageFlags.Ephemeral });
    }
    return true;
  }
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName(CREATE_CMD)
    .setDescription('เปิดแผงสร้างห้องข้อความ / ห้องเสียง / หมวดหมู่')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),
].map((c) => c.toJSON());

registerImagePanel('create', (i) => buildCreatePanel(i.guild, i.user.id));

module.exports = {
  buildCreatePanel,
  CREATE_CMD,
  createState,
  commands,
  handleInteraction: handleCreateInteraction,
  handleCreateInteraction,
};
