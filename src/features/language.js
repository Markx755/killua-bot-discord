'use strict';
const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { getCfg, save } = require('../db');
const { tr } = require('../i18n');
const { refreshGate } = require('./verify');

const LANG_CMD = 'เปลี่ยนภาษาเซิฟเวอร์';

const commands = [
  new SlashCommandBuilder()
    .setName(LANG_CMD)
    .setDescription('เปลี่ยนภาษาของบอทในเซิร์ฟเวอร์ TH/EN')
    .addStringOption((o) =>
      o
        .setName('language')
        .setDescription('เลือกภาษา TH หรือ EN')
        .setRequired(true)
        .addChoices({ name: 'TH (ไทย)', value: 'th' }, { name: 'EN (English)', value: 'en' }),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

async function handleLanguageInteraction(i) {
  if (!(i.isChatInputCommand() && i.commandName === LANG_CMD)) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  const cfg = getCfg(g);
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  cfg.lang = i.options.getString('language', true) === 'en' ? 'en' : 'th';
  save();
  await i.reply({ content: tr(g, 'langSet'), flags: MessageFlags.Ephemeral });
  refreshGate(i.guild).catch(() => {});
  return true;
}

module.exports = {
  LANG_CMD,
  commands,
  handleInteraction: handleLanguageInteraction,
  handleLanguageInteraction,
};
