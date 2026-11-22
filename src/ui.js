'use strict';
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { db } = require('./db');
const { tr } = require('./i18n');
const { E, em } = require('./emoji');

// ---------- ภาพประจำระบบ (ใส่ลิ้งภาพได้ทุกระบบ) ----------
const imgItems = (gid, key) => {
  const url = db[gid]?.images?.[key];
  return url ? [new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url))] : [];
};

const imgButton = (gid, key) =>
  new ButtonBuilder()
    .setCustomId(`img_set:${key}`)
    .setLabel(tr(gid, 'btnImage'))
    .setEmoji(em(E.window))
    .setStyle(ButtonStyle.Secondary);

const modalInput = (id, label, value, required = true, long = false) => {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required);
  if (long) t.setMaxLength(1800);
  if (value !== '' && value !== undefined) t.setValue(String(value));
  return new ActionRowBuilder().addComponents(t);
};

const v2Text = (t) => new TextDisplayBuilder().setContent(t);

const v2Line = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

const ephV2 = (t) => ({
  components: [new ContainerBuilder().addTextDisplayComponents(v2Text(t))],
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
});

module.exports = {
  imgItems,
  imgButton,
  modalInput,
  v2Text,
  v2Line,
  ephV2,
};
