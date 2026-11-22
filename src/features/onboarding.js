'use strict';
const {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { v2Line, v2Text } = require('../ui');
const { tr } = require('../i18n');
const { E, em } = require('../emoji');
const { client } = require('../client');
const { db, getCfg, save } = require('../db');
const { LOG_CATEGORY, LOG_CHANNELS, ensureLogChannels, linkLogChannels } = require('../killua-logs');

// ---------- ระบบต้อนรับเมื่อถูกเชิญ (Onboarding) ----------
// ขั้นตอน: DM ให้ยืนยัน -> แผงสอนตั้งยศ Administrator + ลากไว้บนสุด -> สร้างหมวดหมู่/ห้อง log + บันทึกสิ่งที่ทำ
const SETUP_CMD = 'ตั้งค่าเริ่มต้น';

const OB_CATEGORY = LOG_CATEGORY;

const OB_CHANNELS = LOG_CHANNELS;

const obRunning = new Set();

// guild ที่กำลังตั้งค่าอยู่ กันทำซ้ำ
const obTimers = new Map();

// หน่วงเวลาตรวจสิทธิ์ซ้ำตอนมีการแก้ยศ

const obBox = (color) => new ContainerBuilder().setAccentColor(color);

const obPayload = (c) => ({ components: [c], flags: MessageFlags.IsComponentsV2 });

const obSimple = (g, key, color) => obPayload(obBox(color).addTextDisplayComponents(v2Text(tr(g, key))));

const obMention = (c, id) => (id ? c.addTextDisplayComponents(v2Text(`<@${id}>`)) : c);

// ตรวจสิทธิ์ของบอท: ต้องมี Administrator และยศอยู่สูงสุดเท่าที่ผู้ตั้งค่าจะลากให้ได้
async function obChecks(guild, userId) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const admin = me.permissions.has(PermissionFlagsBits.Administrator);
  const myTop = me.roles.highest.position;
  const aboveAll = !guild.roles.cache.some((r) => r.id !== guild.id && !r.managed && r.position >= myTop);
  let abovePerson = false;
  if (userId && userId !== guild.ownerId) {
    const m = await guild.members.fetch(userId).catch(() => null);
    if (m) abovePerson = myTop > m.roles.highest.position; // ผู้ตั้งค่าไม่ใช่เจ้าของ: สูงกว่ายศสูงสุดของเขาก็พอ
  }
  const pos = aboveAll || abovePerson;
  return { admin, pos, ok: admin && pos };
}

// แผงที่ 1: ถามยืนยันการเชิญ
function buildObAsk(guild, mentionId) {
  const g = guild.id;
  const c = obMention(obBox(0x5865f2), mentionId)
    .addTextDisplayComponents(v2Text(`${tr(g, 'obAskTitle')}\n${tr(g, 'obAskBody', guild.name)}`))
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ob_start:${g}`)
          .setLabel(tr(g, 'obBtnConfirm'))
          .setEmoji(em(E.verify))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ob_leave:${g}`)
          .setLabel(tr(g, 'obBtnLeave'))
          .setEmoji(em(E.warn))
          .setStyle(ButtonStyle.Danger),
      ),
    )
    .addTextDisplayComponents(v2Text(tr(g, 'obAskFooter')));
  return obPayload(c);
}

// แผงที่ 2: สอนตั้งยศ + แสดงสถานะสิทธิ์สด (waiting = รอการอัปเดต)
async function buildObPerms(guild, userId, waiting = false, mentionId = null) {
  const g = guild.id;
  const chk = await obChecks(guild, userId);
  const head = waiting
    ? `${tr(g, 'obWaitTitle')}\n${tr(g, 'obWaitBody')}`
    : `${tr(g, 'obPermsTitle')}\n${tr(g, 'obPermsBody', guild.name)}`;
  const c = obMention(obBox(waiting ? 0xfee75c : 0xed4245), mentionId)
    .addTextDisplayComponents(v2Text(head))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(`${tr(g, 'obCheckAdmin', chk.admin)}\n${tr(g, 'obCheckPos', chk.pos)}\n\n${tr(g, 'obPermsNote')}`),
    )
    .addSeparatorComponents(v2Line())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ob_check:${g}`)
          .setLabel(tr(g, waiting ? 'obBtnRecheck' : 'obBtnConfirm'))
          .setEmoji(em(waiting ? E.refresh : E.verify))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ob_cancel:${g}`)
          .setLabel(tr(g, 'obBtnCancel'))
          .setEmoji(em(E.warn))
          .setStyle(ButtonStyle.Danger),
      ),
    )
    .addTextDisplayComponents(v2Text(tr(g, 'obPermsFooter')));
  return obPayload(c);
}

// แผงที่ 3: ตั้งค่าเสร็จ
function buildObDone(guild, res) {
  const g = guild.id;
  const list = OB_CHANNELS.filter((x) => res.channels[x.key])
    .map((x) => `${E.bullet} <#${res.channels[x.key]}> — ${tr(g, 'obDesc_' + x.key)}`)
    .join('\n');
  const c = obBox(0x57f287)
    .addTextDisplayComponents(v2Text(`${tr(g, 'obDoneTitle')}\n${tr(g, 'obDoneBody', guild.name)}`))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(
      v2Text(`${res.categoryId ? `${E.bullet} <#${res.categoryId}>\n` : ''}${list}` + (res.failed ? `\n\n${tr(g, 'obDoneWarn', res.failed)}` : '')),
    )
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(v2Text(tr(g, 'obDoneFooter')));
  return obPayload(c);
}

// บันทึกความคืบหน้าใน setup-log
function buildObLog(g, userId, lines, finished) {
  const c = obBox(finished ? 0x57f287 : 0x5865f2)
    .addTextDisplayComponents(v2Text(`${tr(g, 'obLgTitle')}\n${tr(g, 'obLgBy', userId, Math.floor(Date.now() / 1000))}`))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(v2Text(lines.map((l) => `${E.bullet} ${l}`).join('\n').slice(0, 3800)))
    .addSeparatorComponents(v2Line())
    .addTextDisplayComponents(v2Text(tr(g, finished ? 'obLgDone' : 'obLgRunning')));
  return obPayload(c);
}

// หาคนที่เชิญบอท (จาก audit log) ถ้าไม่ได้ใช้เจ้าของเซิร์ฟเวอร์
async function findInviter(guild) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 });
    const e = logs.entries.find((x) => x.target?.id === client.user.id && Date.now() - x.createdTimestamp < 10 * 60_000);
    if (e?.executor) return e.executor;
  } catch {
    /* ไม่มีสิทธิ์ดู audit log */
  }
  return client.users.fetch(guild.ownerId).catch(() => null);
}

function fallbackChannel(guild) {
  const me = guild.members.me;
  const ok = (c) =>
    c?.type === ChannelType.GuildText &&
    c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  if (ok(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache.find(ok) ?? null;
}

// เริ่มขั้นตอน: ส่ง DM (ถ้า DM ไม่ได้ส่งในห้องแทน)
async function startOnboarding(guild, opts = {}) {
  const g = guild.id;
  const cfg = getCfg(g);
  cfg.lang ??= guild.preferredLocale?.startsWith('th') ? 'th' : 'en';
  const inviter = opts.user ?? (await findInviter(guild));
  console.log(`[onboard] ${guild.name} (${g}) inviter=${inviter?.id ?? 'ไม่พบ'}`);
  if (!inviter) return { sent: false };

  // ลำดับการส่ง: DM ผู้เชิญ → DM เจ้าของเซิร์ฟเวอร์ → ห้องข้อความในเซิร์ฟเวอร์
  const candidates = [inviter];
  if (!opts.user && guild.ownerId && guild.ownerId !== inviter.id) {
    const owner = await client.users.fetch(guild.ownerId).catch(() => null);
    if (owner) candidates.push(owner);
  }

  let user = inviter;
  let msg = null;
  let viaDm = false;
  for (const cand of candidates) {
    try {
      msg = await cand.send(await (opts.skipAsk ? buildObPerms(guild, cand.id, false, null) : buildObAsk(guild, null)));
      user = cand;
      viaDm = true;
      console.log(`[onboard] ส่ง DM ถึง ${cand.id} สำเร็จ`);
      break;
    } catch (err) {
      console.error(`[onboard] ส่ง DM ถึง ${cand.id} ไม่สำเร็จ:`, err?.code ?? '', err?.message ?? err);
    }
  }
  if (!msg) {
    const ch = fallbackChannel(guild);
    if (!ch) console.error('[onboard] ไม่มีห้องที่บอทส่งข้อความได้');
    else {
      try {
        const payload = opts.skipAsk ? await buildObPerms(guild, user.id, false, user.id) : buildObAsk(guild, user.id);
        msg = await ch.send({ ...payload, allowedMentions: { users: [user.id] } });
        console.log(`[onboard] ส่งในห้อง #${ch.name} แทน`);
      } catch (err) {
        console.error('[onboard] ส่งในห้องไม่สำเร็จ:', err?.code ?? '', err?.message ?? err);
      }
    }
  }
  cfg.onboard = { state: opts.skipAsk ? 'perms' : 'ask', userId: user.id, waiting: false };
  if (!msg) {
    cfg.onboard = { state: 'failed', userId: user.id };
    save();
    return { sent: false };
  }
  Object.assign(cfg.onboard, { dm: viaDm, channelId: msg.channelId, messageId: msg.id });
  save();
  return { sent: true, dm: viaDm };
}

async function getObMessage(guild) {
  const ob = db[guild.id]?.onboard;
  if (!ob?.messageId) return null;
  try {
    if (ob.dm) {
      const dm = await (await client.users.fetch(ob.userId)).createDM();
      return await dm.messages.fetch(ob.messageId);
    }
    return (await guild.channels.cache.get(ob.channelId)?.messages.fetch(ob.messageId)) ?? null;
  } catch {
    return null;
  }
}

// สร้างหมวดหมู่ + ห้อง log แล้วบันทึกทุกขั้นตอนใน setup-log
async function runOnboardSetup(guild, userId) {
  const g = guild.id;
  const cfg = getCfg(g);
  const ob = (cfg.onboard ??= {});
  ob.state = 'running';
  save();

  const lines = [];
  let setupCh = null;
  let logMsg = null;
  const push = async (line) => {
    lines.push(line); // ยังไม่มีห้อง Announcements ก็เก็บไว้ก่อน แล้วส่งรวมตอนห้องพร้อม
    if (!setupCh) return;
    const payload = { ...buildObLog(g, userId, lines, false), allowedMentions: { parse: [] } };
    if (logMsg) await logMsg.edit(payload).catch(() => {});
    else logMsg = await setupCh.send(payload).catch(() => null);
  };

  // 1-2) หมวดหมู่ส่วนตัว (Killua + เจ้าของ) + ห้อง log  — บันทึกความคืบหน้าในห้อง Announcements
  const made = await ensureLogChannels(guild, async (st) => {
    if (st.kind === 'category') {
      lines.push(tr(g, 'obStepPerm'));
      lines.push(tr(g, st.created ? 'obStepCat' : 'obStepCatKeep', st.channel.id));
    } else if (st.kind === 'channel') {
      if (st.key === 'announce') setupCh = st.channel; // ตั้งก่อน push เพื่อให้บรรทัดที่ค้างไว้ถูกส่งลง log
      await push(st.created ? tr(g, 'obStepCh', st.channel.id, tr(g, 'obDesc_' + st.key)) : tr(g, 'obStepChKeep', st.channel.id));
    } else {
      await push(tr(g, 'obStepFail', st.name));
    }
  });
  const res = { categoryId: made.category?.id ?? null, channels: {}, failed: made.failed };
  for (const [k, ch] of Object.entries(made.channels)) res.channels[k] = ch.id;
  ob.categoryId = res.categoryId;
  ob.channels = res.channels;

  // 3) ผูกห้อง log เข้ากับระบบต่างๆ (ไม่ทับที่ตั้งไว้แล้วและยังใช้ได้อยู่)
  for (const l of linkLogChannels(guild, made.channels)) {
    await push(l.kept ? tr(g, 'obStepKeep', l.sys) : tr(g, 'obStepLink', l.sys, l.id));
  }

  // 4) ประกาศต้อนรับ
  const ann = made.channels.announce;
  if (ann) {
    const welcome = obBox(0x5865f2)
      .addTextDisplayComponents(v2Text(`${tr(g, 'obAnnTitle')}\n${tr(g, 'obAnnBody')}`))
      .addSeparatorComponents(v2Line())
      .addTextDisplayComponents(v2Text(tr(g, 'obAnnFooter')));
    const sent = await ann.send({ ...obPayload(welcome), allowedMentions: { parse: [] } }).catch(() => null);
    await push(tr(g, sent ? 'obStepAnn' : 'obStepFail', sent ? ann.id : 'announcements'));
  }

  ob.state = 'done';
  ob.waiting = false;
  ob.doneAt = Date.now();
  ob.userId = userId;
  save();

  if (logMsg) {
    await logMsg
      .edit({ ...buildObLog(g, userId, lines, true), allowedMentions: { parse: [] } })
      .catch(() => {});
  }
  return res;
}

// ทำขั้นตอนหลังผ่านการตรวจสิทธิ์ (edit = ฟังก์ชันอัปเดตข้อความแผง)
async function proceedOnboard(guild, userId, edit) {
  const g = guild.id;
  if (obRunning.has(g)) return;
  obRunning.add(g);
  try {
    await edit(obSimple(g, 'obRunning', 0x5865f2));
    const res = await runOnboardSetup(guild, userId);
    await edit(buildObDone(guild, res));
  } catch (err) {
    console.error('[onboard] setup failed:', err);
    const ob = db[g]?.onboard;
    if (ob) {
      ob.state = 'perms';
      ob.waiting = true;
      save();
    }
    await edit(obSimple(g, 'obFail', 0xed4245)).catch(() => {});
  } finally {
    obRunning.delete(g);
  }
}

// มีการแก้ยศ/สิทธิ์ของบอท -> ตรวจซ้ำอัตโนมัติ (หน่วง 2 วินาทีรวมเหตุการณ์ติดๆ กัน)
function onboardRecheck(gid) {
  const ob = db[gid]?.onboard;
  if (!ob || ob.state !== 'perms' || !ob.waiting) return;
  clearTimeout(obTimers.get(gid));
  obTimers.set(
    gid,
    setTimeout(async () => {
      try {
        const guild = client.guilds.cache.get(gid);
        const cur = db[gid]?.onboard;
        if (!guild || !cur || cur.state !== 'perms' || !cur.waiting || obRunning.has(gid)) return;
        const chk = await obChecks(guild, cur.userId);
        if (!chk.ok) {
          const m = await getObMessage(guild);
          if (m) await m.edit(await buildObPerms(guild, cur.userId, true)).catch(() => {});
          return;
        }
        cur.waiting = false;
        save();
        await proceedOnboard(guild, cur.userId, async (p) => (await getObMessage(guild))?.edit(p));
      } catch (err) {
        console.error('[onboard] recheck failed:', err.message);
      }
    }, 2_000),
  );
}

async function handleOnboardInteraction(i) {
  const cmd = i.isChatInputCommand() ? i.commandName : null;
  const cid = i.customId ?? '';
  const isOb = i.isButton() && /^ob_(start|leave|check|cancel):\d+$/.test(cid);
  if (cmd !== SETUP_CMD && !isOb) return false;

  // /ตั้งค่าเริ่มต้น : เริ่มขั้นตอนตรวจสิทธิ์ใหม่ (ส่งทาง DM)
  if (cmd === SETUP_CMD) {
    if (!i.guild) return true;
    const g = i.guild.id;
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({ content: tr(g, 'noPerm'), flags: MessageFlags.Ephemeral });
      return true;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await startOnboarding(i.guild, { user: i.user, skipAsk: true });
    await i.editReply(tr(g, !r.sent ? 'obStartFail' : r.dm ? 'obStartDm' : 'obStartCh'));
    return true;
  }

  // --- ปุ่ม onboarding (อาจมาจาก DM หรือในเซิร์ฟเวอร์) ---
  const cidParts = cid.slice(3).split(':');
  const action = cidParts[0];
  const gid = cidParts[1];
  if (!gid) return true;

  // Resolve guild from cache
  const guild = client.guilds.cache.get(gid);
  if (!guild) {
    await i.reply({ content: tr(gid, 'obGone'), flags: MessageFlags.Ephemeral });
    return true;
  }

  const g = guild.id;
  const cfg = getCfg(g);
  const ob = (cfg.onboard ??= {});

  // Check permissions: owner, the user who started, or anyone with ManageGuild
  let allowed = i.user.id === guild.ownerId || i.user.id === ob.userId;
  if (!allowed) {
    // Try to fetch member for permission check (works for DM interactions too)
    const member = await guild.members.fetch(i.user.id).catch(() => null);
    if (member) {
      allowed = member.permissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    }
  }
  if (!allowed) {
    await i.reply({ content: tr(g, 'obNoPerm'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'start') {
    ob.state = 'perms';
    ob.waiting = false;
    ob.userId = i.user.id;
    save();
    await i.deferUpdate();
    await i.editReply(await buildObPerms(guild, i.user.id));
    return true;
  }

  if (action === 'leave') {
    ob.state = 'left';
    save();
    await i.update(obSimple(g, 'obLeft', 0xed4245));
    await guild.leave().catch(() => {});
    return true;
  }

  if (action === 'cancel') {
    ob.state = 'cancelled';
    ob.waiting = false;
    save();
    await i.update(obSimple(g, 'obCancelled', 0xed4245));
    return true;
  }

  // action === 'check' : ตรวจสิทธิ์ ถ้าผ่านเริ่มสร้างหมวดหมู่/ห้อง log ทันที
  if (ob.state === 'done' || obRunning.has(g)) {
    await i.deferUpdate().catch(() => {});
    return true;
  }

  await i.deferUpdate();
  const chk = await obChecks(guild, i.user.id);
  if (!chk.ok) {
    ob.state = 'perms';
    ob.waiting = true;
    ob.userId = i.user.id;
    save();
    await i.editReply(await buildObPerms(guild, i.user.id, true));
    return true;
  }
  ob.userId = i.user.id;
  ob.waiting = false;
  save();
  await proceedOnboard(guild, i.user.id, (p) => i.editReply(p));
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName(SETUP_CMD)
    .setDescription('ตั้งค่า Killua ใหม่: ตรวจสิทธิ์ยศ + สร้างหมวดหมู่และห้อง log (ส่งขั้นตอนทาง DM)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
].map((c) => c.toJSON());

// ---------- ถูกเชิญเข้าเซิร์ฟเวอร์ / แก้ยศของบอท ----------
client.on('guildCreate', (guild) => {
  startOnboarding(guild).catch((err) => console.error('[onboard] start failed:', err));
});
client.on('roleUpdate', (_old, role) => onboardRecheck(role.guild.id));
client.on('guildMemberUpdate', (_old, member) => {
  if (member.id === client.user.id) onboardRecheck(member.guild.id);
});

function onReady() {
  // ตรวจสิทธิ์ซ้ำเป็นระยะ (กันพลาดเหตุการณ์ และหลังรีสตาร์ท)
  setInterval(() => Object.keys(db).forEach(onboardRecheck), 15_000);
}

module.exports = {
  obChecks,
  buildObAsk,
  buildObPerms,
  buildObDone,
  buildObLog,
  findInviter,
  fallbackChannel,
  startOnboarding,
  getObMessage,
  runOnboardSetup,
  proceedOnboard,
  onboardRecheck,
  SETUP_CMD,
  OB_CATEGORY,
  OB_CHANNELS,
  obRunning,
  obTimers,
  obBox,
  obPayload,
  obSimple,
  obMention,
  commands,
  handleInteraction: handleOnboardInteraction,
  handleOnboardInteraction,
  onReady,
};