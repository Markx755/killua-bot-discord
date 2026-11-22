'use strict';
const crypto = require('crypto');
const http = require('http');
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
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { E, em } = require('../emoji');
const { langOf, tr } = require('../i18n');
const { sendLogTo } = require('../log');
const { db, getCfg, save } = require('../db');
const { ephV2, imgButton, imgItems, modalInput, v2Line, v2Text } = require('../ui');
const { client } = require('../client');
const { registerImagePanel } = require('./images');

// ---------- ระบบยืนยันตัวตน + ภาษา + ตั้งภาพ ----------
const VERIFY_CMD = 'ระบบยืนยันตัวตน';

const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

const WEB_PORT = Number(process.env.PORT || 3000);

const VERIFY_EMOJI = { web: E.google, button: E.verify, modal: '📝' };

const typeLabel = (g, t) => tr(g, t === 'web' ? 'typeWeb' : t === 'modal' ? 'typeModal' : 'typeButton');

const pendingCodes = new Map();

// guild:user -> { code, exp, tries }
const webTokens = new Map();

// token -> { guildId, userId, exp, question, answer, tries }

async function grantVerified(guild, member, user) {
  const v = db[guild.id]?.verify;
  if (!v?.roleId) return false;
  try {
    await member.roles.add(v.roleId, 'Verification');
  } catch {
    return false;
  }
  const logCh = v.logChannelId && guild.channels.cache.get(v.logChannelId);
  if (logCh) {
    sendLogTo(logCh, { body: tr(guild.id, 'logLine', user), source: 'JoinGate', color: 0x57f287 });
  }
  return true;
}

// หน้ายืนยันตัวตนที่สมาชิกเห็นในห้อง Verify
function buildGate(guild) {
  const g = guild.id;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(v2Text(`## ${tr(g, 'gateTitle')}\n${tr(g, 'gateDesc')}`))
    .addMediaGalleryComponents(...imgItems(g, 'verify'))
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_do')
          .setLabel(tr(g, 'btnVerify'))
          .setEmoji(em(E.verify))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('verify_why')
          .setLabel(tr(g, 'btnWhy'))
          .setEmoji(em(E.info))
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// แผงตั้งค่าสำหรับแอดมิน
function buildVerifyPanel(guild, note) {
  const g = guild.id;
  const v = (getCfg(g).verify ??= {});
  const mention = (id, prefix) => (id ? `${prefix}${id}>` : `\`${tr(g, 'vUnset')}\``);
  const hasImg = !!db[g]?.images?.verify;

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('verify_role')
    .setPlaceholder(tr(g, 'phRole'))
    .setMinValues(1)
    .setMaxValues(1);
  if (v.roleId) roleSelect.setDefaultRoles(v.roleId);

  const gateSelect = new ChannelSelectMenuBuilder()
    .setCustomId('verify_gate_ch')
    .setPlaceholder(tr(g, 'phGate'))
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (v.gateChannelId) gateSelect.setDefaultChannels(v.gateChannelId);

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId('verify_log_ch')
    .setPlaceholder(tr(g, 'phLog'))
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (v.logChannelId) logSelect.setDefaultChannels(v.logChannelId);

  const curType = v.type ?? 'button';
  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('verify_type')
    .setPlaceholder(tr(g, 'phType'))
    .addOptions(
      ['web', 'button', 'modal'].map((t) => ({
        label: typeLabel(g, t),
        value: t,
        emoji: em(VERIFY_EMOJI[t]),
        default: t === curType,
      })),
    );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      v2Text(
        `${tr(g, 'vTitle')}\n\n` +
          `**${tr(g, 'vRole')}:** ${mention(v.roleId, '<@&')}\n` +
          `**${tr(g, 'vGate')}:** ${mention(v.gateChannelId, '<#')}\n` +
          `**${tr(g, 'vLog')}:** ${mention(v.logChannelId, '<#')}\n` +
          `**${tr(g, 'vType')}:** ${VERIFY_EMOJI[curType]} ${typeLabel(g, curType)}\n` +
          `**${tr(g, 'vImage')}:** ${hasImg ? tr(g, 'vImgSet') : tr(g, 'vImgNone')}` +
          (note ? `\n\n${note}` : ''),
      ),
    )
    .addMediaGalleryComponents(...imgItems(g, 'verify'))
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(gateSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(logSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(typeSelect))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_send')
          .setLabel(tr(g, 'btnSend'))
          .setEmoji(em(E.ok))
          .setStyle(ButtonStyle.Success),
        imgButton(g, 'verify'),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// อัปเดตหน้ายืนยันที่ส่งไปแล้ว (เปลี่ยนภาษา/ภาพ)
async function refreshGate(guild) {
  const v = db[guild.id]?.verify;
  if (!v?.gateChannelId || !v.gateMessageId) return;
  const ch = guild.channels.cache.get(v.gateChannelId);
  const msg = await ch?.messages.fetch(v.gateMessageId).catch(() => null);
  if (msg) await msg.edit(buildGate(guild)).catch(() => {});
}

// ---------- เว็บยืนยันตัวตน (ใช้เมื่อเลือกแบบ Website) ----------
function startWebServer() {
  if (!PUBLIC_URL) return;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = (lang, title, body) =>
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<style>body{font-family:sans-serif;background:#2b2d31;color:#fff;display:flex;min-height:100vh;` +
    `align-items:center;justify-content:center;margin:0}.card{background:#383a40;padding:32px;` +
    `border-radius:16px;max-width:360px;width:90%;text-align:center}input{width:100%;padding:12px;` +
    `border-radius:8px;border:0;margin:12px 0;font-size:18px;box-sizing:border-box;text-align:center}` +
    `button{width:100%;padding:12px;border:0;border-radius:8px;background:#248046;color:#fff;` +
    `font-size:16px;cursor:pointer}.err{color:#f38688}</style></head><body><div class="card">${body}</div></body></html>`;

  http
    .createServer(async (req, res) => {
      const send = (code, html) => {
        res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      };
      try {
        const m = /^\/verify\/([a-f0-9]{32})$/.exec((req.url || '').split('?')[0]);
        const t = m && webTokens.get(m[1]);
        if (!t || t.exp < Date.now()) {
          if (m) webTokens.delete(m[1]);
          return send(404, page('th', 'Expired', '<p>ลิงก์หมดอายุ / Link expired</p>'));
        }
        const lang = langOf(t.guildId);
        const form = (err) =>
          page(
            lang,
            tr(t.guildId, 'webTitle'),
            `<h2>${esc(tr(t.guildId, 'webTitle'))}</h2><p>${esc(t.question)}</p>` +
              (err ? `<p class="err">${esc(err)}</p>` : '') +
              `<form method="POST"><input name="answer" inputmode="numeric" autocomplete="off" required>` +
              `<button type="submit">${esc(tr(t.guildId, 'webBtn'))}</button></form>`,
          );

        if (req.method === 'GET') return send(200, form(''));
        if (req.method !== 'POST') return send(405, page(lang, 'Error', '<p>Method not allowed</p>'));

        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) return send(413, page(lang, 'Error', '<p>Too large</p>'));
        }
        const answer = (new URLSearchParams(body).get('answer') || '').trim();
        if (answer !== t.answer) {
          t.tries += 1;
          if (t.tries >= 5) {
            webTokens.delete(m[1]);
            return send(403, page('th', 'Expired', '<p>ลิงก์หมดอายุ / Link expired</p>'));
          }
          return send(200, form(tr(t.guildId, 'webWrong')));
        }

        webTokens.delete(m[1]);
        const guild = client.guilds.cache.get(t.guildId);
        const member = guild && (await guild.members.fetch(t.userId).catch(() => null));
        const ok = member && (await grantVerified(guild, member, member.user));
        return send(
          200,
          page(lang, tr(t.guildId, 'webTitle'), `<h2>${esc(ok ? tr(t.guildId, 'webDone') : tr(t.guildId, 'webFail'))}</h2>`),
        );
      } catch (err) {
        console.error('web verify error:', err);
        send(500, page('th', 'Error', '<p>Error</p>'));
      }
    })
    .listen(WEB_PORT, () => console.log(`🌐 Web verify พร้อมที่พอร์ต ${WEB_PORT} (${PUBLIC_URL})`));
}

// ล้างรหัส/โทเคนที่หมดอายุ ทุก 5 นาที
setInterval(() => {
  const now = Date.now();
  for (const map of [pendingCodes, webTokens]) {
    for (const [k, v] of map) if (v.exp < now) map.delete(k);
  }
}, 300_000);

const commands = [
  new SlashCommandBuilder()
    .setName(VERIFY_CMD)
    .setDescription('ตั้งค่าระบบยืนยันตัวตนสมาชิกใหม่ (Verification)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

async function handleVerifyInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  const isPublic =
    (i.isButton() && ['verify_do', 'verify_why', 'verify_enter'].includes(cid)) ||
    (i.isModalSubmit() && cid === 'verify_code_modal');
  const mine = cmd === VERIFY_CMD || isPublic || cid.startsWith('verify_');
  if (!mine) return false;
  if (!i.guild) return true;

  const g = i.guild.id;
  const cfg = getCfg(g);
  const v = (cfg.verify ??= {});

  // ----- สมาชิกกดปุ่มในหน้ายืนยัน -----
  if (isPublic) {
    if (cid === 'verify_why') {
      await i.reply(ephV2(tr(g, 'whyBody')));
      return true;
    }
    if (!v.roleId) {
      await i.reply(ephV2(tr(g, 'notConfigured')));
      return true;
    }
    if (i.member.roles.cache.has(v.roleId)) {
      await i.reply(ephV2(tr(g, 'already')));
      return true;
    }
    const key = `${g}:${i.user.id}`;

    // แบบ Modal: กดปุ่มเพื่อเปิดช่องกรอกรหัส
    if (cid === 'verify_enter') {
      await i.showModal(
        new ModalBuilder()
          .setCustomId('verify_code_modal')
          .setTitle(tr(g, 'modalTitle'))
          .addComponents(modalInput('code', tr(g, 'modalLabel'), '', true)),
      );
      return true;
    }
    // แบบ Modal: ตรวจรหัสที่กรอก
    if (cid === 'verify_code_modal') {
      const p = pendingCodes.get(key);
      if (!p || p.exp < Date.now()) {
        pendingCodes.delete(key);
        await i.reply(ephV2(tr(g, 'codeExpired')));
        return true;
      }
      const input = i.fields.getTextInputValue('code').trim().toUpperCase();
      if (input !== p.code) {
        p.tries += 1;
        if (p.tries >= 3) {
          pendingCodes.delete(key);
          await i.reply(ephV2(tr(g, 'codeExpired')));
        } else {
          await i.reply(ephV2(tr(g, 'codeWrong', 3 - p.tries)));
        }
        return true;
      }
      pendingCodes.delete(key);
      const ok = await grantVerified(i.guild, i.member, i.user);
      await i.reply(ephV2(ok ? tr(g, 'success') : tr(g, 'roleFail')));
      return true;
    }

    // กดปุ่ม Verify ในหน้ายืนยัน: แยกตามรูปแบบที่ตั้งไว้
    const type = v.type ?? 'button';
    if (type === 'modal') {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let n = 0; n < 5; n++) code += alphabet[crypto.randomInt(alphabet.length)];
      pendingCodes.set(key, { code, exp: Date.now() + 5 * 60_000, tries: 0 });
      await i.reply({
        components: [
          new ContainerBuilder()
            .addTextDisplayComponents(v2Text(tr(g, 'codeMsg', code)))
            .addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('verify_enter')
                  .setLabel(tr(g, 'btnEnter'))
                  .setEmoji('📝')
                  .setStyle(ButtonStyle.Primary),
              ),
            ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return true;
    }
    if (type === 'web') {
      if (!PUBLIC_URL) {
        await i.reply(ephV2(tr(g, 'webUnavailable')));
        return true;
      }
      for (const [tk, t] of webTokens) if (t.userId === i.user.id && t.guildId === g) webTokens.delete(tk);
      const token = crypto.randomBytes(16).toString('hex');
      const a = crypto.randomInt(10, 50);
      const b = crypto.randomInt(10, 50);
      webTokens.set(token, {
        guildId: g,
        userId: i.user.id,
        exp: Date.now() + 10 * 60_000,
        question: `${a} + ${b} = ?`,
        answer: String(a + b),
        tries: 0,
      });
      await i.reply(ephV2(tr(g, 'webMsg', `${PUBLIC_URL}/verify/${token}`)));
      return true;
    }

    // แบบ Button: กดแล้วได้ยศทันที
    const ok = await grantVerified(i.guild, i.member, i.user);
    await i.reply(ephV2(ok ? tr(g, 'success') : tr(g, 'roleFail')));
    return true;
  }

  // ----- ต่อจากนี้ต้องเป็นแอดมิน -----
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (cmd === VERIFY_CMD) {
    await i.reply(buildVerifyPanel(i.guild));
    return true;
  }

  // ----- เมนูและปุ่มของแผงยืนยันตัวตน -----
  let note = '';
  if (i.isRoleSelectMenu() && cid === 'verify_role') {
    v.roleId = i.values[0];
    const role = i.guild.roles.cache.get(v.roleId);
    const me = i.guild.members.me;
    if (role && me && me.roles.highest.comparePositionTo(role) <= 0) note = tr(g, 'roleTooHigh');
  } else if (i.isChannelSelectMenu() && cid === 'verify_gate_ch') {
    v.gateChannelId = i.values[0];
    v.gateMessageId = null; // เปลี่ยนห้อง ต้องส่งหน้ายืนยันใหม่
  } else if (i.isStringSelectMenu() && cid === 'verify_type') {
    v.type = ['web', 'button', 'modal'].includes(i.values[0]) ? i.values[0] : 'button';
    if (v.type === 'web' && !PUBLIC_URL) note = tr(g, 'webNeedUrl');
  } else if (i.isChannelSelectMenu() && cid === 'verify_log_ch') {
    v.logChannelId = i.values[0];
  } else if (i.isButton() && cid === 'verify_send') {
    if (!v.roleId || !v.gateChannelId) {
      await i.reply({ content: tr(g, 'needSetup'), flags: MessageFlags.Ephemeral });
      return true;
    }
    await i.deferUpdate();
    try {
      const ch = i.guild.channels.cache.get(v.gateChannelId);
      const old = v.gateMessageId ? await ch.messages.fetch(v.gateMessageId).catch(() => null) : null;
      if (old) {
        await old.edit(buildGate(i.guild));
      } else {
        const sent = await ch.send(buildGate(i.guild));
        v.gateMessageId = sent.id;
      }
      note = tr(g, 'gateSent');
    } catch (err) {
      console.error(err);
      note = tr(g, 'sendFail');
    }
    save();
    await i.editReply(buildVerifyPanel(i.guild, note));
    return true;
  } else {
    return true;
  }
  save();
  await i.update(buildVerifyPanel(i.guild, note));
  return true;
}

function onReady() {
  startWebServer();
}

registerImagePanel('verify', (i) => buildVerifyPanel(i.guild), (guild) => refreshGate(guild));

module.exports = {
  grantVerified,
  buildGate,
  buildVerifyPanel,
  refreshGate,
  startWebServer,
  VERIFY_CMD,
  PUBLIC_URL,
  WEB_PORT,
  VERIFY_EMOJI,
  typeLabel,
  pendingCodes,
  webTokens,
  commands,
  handleInteraction: handleVerifyInteraction,
  handleVerifyInteraction,
  onReady,
};
