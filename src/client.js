'use strict';
const {
  Client,
  GatewayIntentBits,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration, // กันการแบน/เตะรัวๆ (Anti-Nuke) และอ่าน audit log
    GatewayIntentBits.GuildMembers, // ต้องเปิด Server Members Intent ใน Developer Portal
    GatewayIntentBits.GuildPresences, // ต้องเปิด Presence Intent ใน Developer Portal
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ต้องเปิด Message Content Intent ใน Developer Portal
  ],
});

module.exports = {
  client,
};
