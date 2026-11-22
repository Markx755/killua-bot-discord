// Killua Bot — จุดเริ่มต้น: โหลดแต่ละระบบจาก src/features/* แล้วต่อเข้ากับ client
// เพิ่มระบบใหม่: สร้างไฟล์ใน src/features/ ที่ export { commands, handleInteraction, onReady } แล้วเพิ่มชื่อในรายการ features ด้านล่าง
require('dotenv').config();

const { client } = require('./src/client');
const { E } = require('./src/emoji');
const { MessageFlags } = require('discord.js');

// ลำดับมีผล: handleInteraction ของแต่ละระบบถูกเรียกตามลำดับนี้ ตัวแรกที่ตอบ true จะหยุดทันที
const features = [
  require('./src/features/onboarding'),
  require('./src/features/verify'),
  require('./src/features/language'),
  require('./src/features/images'),
  require('./src/features/tools'),
  require('./src/features/create'),
  require('./src/features/trap'),
  require('./src/features/antispam'),
  require('./src/features/announce'),
  require('./src/features/antinuke'),
  require('./src/features/voice'),
  require('./src/features/stats'),
];

// ---------- แกะประเภท interaction เป็นข้อความสั้น ----------
function ixType(i) {
  if (i.isChatInputCommand()) return 'slash';
  if (i.isButton()) return 'button';
  if (i.isModalSubmit()) return 'modal';
  if (i.isStringSelectMenu()) return 'string_select';
  if (i.isRoleSelectMenu()) return 'role_select';
  if (i.isChannelSelectMenu()) return 'channel_select';
  return 'other';
}

function ixId(i) {
  if (i.isChatInputCommand()) return i.commandName;
  return i.customId ?? '?';
}

client.once('ready', async () => {
  console.log(`\u2705 ${client.user.tag} \u0e1e\u0e23\u0e49\u0e2d\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19`);
  client.user.setPresence({ activities: [{ name: '/botvoice | Voice 24/7' }], status: 'online' });

  // Initialization isolation: ป้องกันไม่ให้ความผิดพลาดของระบบหนึ่งกระทบระบบอื่น
  try {
    await client.application.commands.set(features.flatMap((f) => f.commands ?? []));
    console.log(`[init] \u0e25\u0e07\u0e17\u0e30\u0e40\u0e1a\u0e35\u0e22\u0e19\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07 ${features.reduce((s, f) => s + (f.commands?.length ?? 0), 0)} \u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07 \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08`);
  } catch (err) {
    console.error('[init] \u0e25\u0e07\u0e17\u0e30\u0e40\u0e1a\u0e35\u0e22\u0e19\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e25\u0e49\u0e21:', err.message);
  }

  for (const f of features) {
    try {
      await f.onReady?.();
    } catch (err) {
      console.error('[init] onReady \u0e25\u0e49\u0e21:', err.message);
    }
  }
});

client.on('interactionCreate', async (i) => {
  const start = Date.now();
  const type = ixType(i);
  const id = ixId(i);
  const guildLabel = i.guild?.id ?? 'DM';
  console.log(`[ix] ${type} ${id} guild=${guildLabel} user=${i.user.id}`);

  let handled = false;
  let autoDeferred = false;
  let safetyTimer = null;

  try {
    // Safety Net: ถ้า handler ยังไม่ acknowledge ภายใน 2 วินาที สั่ง defer อัตโนมัติ
    safetyTimer = setTimeout(() => {
      if (!i.replied && !i.deferred) {
        autoDeferred = true;
        if (i.isChatInputCommand() || i.isModalSubmit()) {
          i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        } else if (i.isButton() || i.isStringSelectMenu() || i.isRoleSelectMenu() || i.isChannelSelectMenu()) {
          i.deferUpdate().catch(() => {});
        }
      }
    }, 2000);

    for (const f of features) {
      if (f.handleInteraction && (await f.handleInteraction(i))) {
        handled = true;
        break;
      }
    }
  } catch (err) {
    console.error(`[ix] ${type} ${id} error:`, err);
    if (!i.replied && !i.deferred) {
      try {
        if (i.isRepliable()) {
          await i.reply({ content: `${E.warn} \u0e40\u0e01\u0e34\u0e14\u0e02\u0e49\u0e2d\u0e1c\u0e34\u0e14\u0e1e\u0e25\u0e32\u0e14`, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // ignore
      }
    }
  } finally {
    clearTimeout(safetyTimer);

    // Fallback: ถ้าไม่มี handler ไหนรับ interaction นี้
    if (!handled && !i.replied && !i.deferred) {
      try {
        if (i.isRepliable()) {
          await i.reply({ content: `${E.warn} \u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e19\u0e35\u0e49\u0e43\u0e19\u0e23\u0e30\u0e1a\u0e1a`, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // ignore
      }
    }

    const duration = Date.now() - start;
    const status = handled ? 'handled' : autoDeferred ? 'auto_deferred' : i.replied || i.deferred ? 'acknowledged' : 'unhandled';
    console.log(`[ix] ${type} ${id} done handler=${status} duration=${duration}ms`);
  }
});

client.login(process.env.TOKEN);