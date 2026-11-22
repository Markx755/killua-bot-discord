'use strict';

// ---------- ตารางอิโมจิ (แก้ที่นี่ที่เดียว) ----------
// รูปแบบ: <:ชื่อ:ไอดี> หรือ <a:ชื่อ:ไอดี> (ตัว a = อิโมจิขยับ)
// บอทต้องอยู่ในเซิร์ฟเวอร์ที่มีอิโมจิเหล่านี้ และมีสิทธิ์ Use External Emojis ในห้องที่ส่ง

// 1) อิโมจิของเซิร์ฟเวอร์ (ตามชื่อในไฟล์ emojis.zip)
const EMOJI = {
  spinner: '<a:emoji_1:1573700039916650658>', // ตัวหมุนโหลดสีเทา
  roblox: '<a:emoji_2:1573700060158623814>', // โลโก้ Roblox
  globe: '<a:emoji_3:1573700074855207053>', // ลูกโลกหมุน
  verified: '<a:emoji_4:1573700091196215356>', // ตรารับรองติ๊กถูก
  crown: '<a:emoji_5:1573700107684024380>', // มงกุฎ
  exclaim: '<a:emoji_6:1573700124025299004>', // เครื่องหมายตกใจ
  discord: '<a:emoji_7:1573702041497247824>', // โลโก้ Discord
  dots: '<a:emoji_8:1573702164357058590>', // จุดสีชมพูเด้ง
  sparks: '<a:emoji_9:1573702220669784175>', // สี่เหลี่ยมสีฟ้าลอย
  ring: '<a:emoji_10:1573702242869969038>', // วงแหวนสีทองหมุน
  loader: '<a:emoji_11:1573702285257740308>', // วงแหวนขาวหมุน
};

// 2) ตำแหน่งที่ใช้ในแผง (อยากสลับตัวไหน แก้ฝั่งขวาได้เลย)
const E = {
  ok: EMOJI.verified, // สถานะเปิด / สำเร็จ / บันทึกแล้ว
  verify: EMOJI.verified, // ปุ่มยืนยัน / เปิดระบบ / หัวข้อระบบยืนยัน
  verifyWhite: EMOJI.verified,
  warn: EMOJI.exclaim, // ปิด / ผิดพลาด / เตือน / Raid
  loading: EMOJI.loader, // กำลังทำงาน
  refresh: EMOJI.spinner, // ปุ่มรีเฟรช
  ring: EMOJI.ring, // หัวข้อ Voice 24/7 (หมุนตลอดเวลา)
  game: EMOJI.discord, // ห้องเสียง
  discord: EMOJI.discord, // ห้องยืนยัน / ห้องใน Discord
  google: EMOJI.globe, // ภาษา / ยืนยันผ่านเว็บ
  dev: EMOJI.globe, // Webhook
  crown: EMOJI.crown, // ยศ
  blocks: EMOJI.roblox, // สร้างห้อง (ก้อนบล็อก)
  star: EMOJI.sparks, // หน้าชื่อแผง
  info: EMOJI.sparks, // ปุ่ม Why / หัวข้อคำอธิบาย
  giveaway: EMOJI.sparks, // ยืนยันสำเร็จ
  window: EMOJI.sparks, // ปุ่มตั้งภาพ
  wingL: EMOJI.sparks, // ตกแต่งหัวหน้ายืนยัน ซ้าย
  wingR: EMOJI.sparks, // ตกแต่งหัวหน้ายืนยัน ขวา
  dots: EMOJI.dots, // ป้ายหัวบรรทัดทั่วไป (เช่น ห้อง log)
  bullet: EMOJI.dots, // หัวข้อย่อยในรายการ
  arrow: EMOJI.dots, // นำหน้าบรรทัดคำอธิบาย
};

// แปลงข้อความ <a:ชื่อ:ไอดี> เป็นออบเจ็กต์ สำหรับปุ่ม/เมนู (ข้อความธรรมดาส่งเป็นสตริงได้เลย)
const em = (s) => {
  const m = /^<(a?):(\w+):(\d+)>$/.exec(s);
  return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : s;
};

// ใน TXT เขียน {ok} {warn} ... แล้วระบบแทนด้วยอิโมจิให้
const ex = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => E[k] ?? m);

module.exports = {
  EMOJI,
  E,
  em,
  ex,
};
