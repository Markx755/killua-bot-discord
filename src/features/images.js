'use strict';
const {
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getCfg, save } = require('../db');
const { tr } = require('../i18n');
const { modalInput } = require('../ui');

// ---------- ตั้งภาพประจำแผง (ใช้ได้ทุกระบบ) ----------
// แต่ละระบบลงทะเบียนวิธีวาดแผงตัวเองด้วย registerImagePanel(key, render, after?)
// เพื่อให้ปุ่ม "ตั้งภาพ" วาดแผงใหม่ได้โดยไม่ต้องรู้จักทุกระบบ
const imagePanels = new Map();
const registerImagePanel = (key, render, after) => imagePanels.set(key, { render, after });

async function handleImageInteraction(i) {
  const cid = i.customId ?? '';
  if (!cid.startsWith('img_')) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  const cfg = getCfg(g);
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (i.isButton() && cid.startsWith('img_set:')) {
    const key = cid.split(':')[1];
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`img_modal:${key}`)
        .setTitle(tr(g, 'imgTitle'))
        .addComponents(modalInput('url', tr(g, 'imgLabel'), cfg.images?.[key] ?? '', false)),
    );
    return true;
  }

  if (i.isModalSubmit() && cid.startsWith('img_modal:')) {
    const key = cid.split(':')[1];
    const url = i.fields.getTextInputValue('url').trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      await i.reply({ content: tr(g, 'imgBad'), flags: MessageFlags.Ephemeral });
      return true;
    }
    cfg.images ??= {};
    if (url) cfg.images[key] = url;
    else delete cfg.images[key];
    save();

    await i.deferUpdate();
    const panel = imagePanels.get(key);
    if (panel) {
      await i.editReply(await panel.render(i));
      if (panel.after) panel.after(i.guild).catch(() => {});
    }
    return true;
  }
  return true;
}

module.exports = {
  imagePanels,
  registerImagePanel,
  handleInteraction: handleImageInteraction,
  handleImageInteraction,
};
