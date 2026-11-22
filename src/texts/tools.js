'use strict';
// ข้อความ TH/EN ของระบบ: tools
// {ชื่อ} ในข้อความ = อิโมจิจาก src/emoji.js (ตาราง E)
module.exports = {
  th: {
    noPermMsg: '{warn} ต้องมีสิทธิ์ Manage Messages ถึงจะใช้ได้',
    purgeDone: (n) => `🗑️ ลบข้อความแล้ว ${n} ข้อความ`,
    purgeNone: '{info} ไม่มีข้อความที่ลบได้ (ข้อความเก่ากว่า 14 วันลบไม่ได้)',
    purgeFail: '{warn} ลบไม่สำเร็จ ตรวจสอบสิทธิ์ Manage Messages ของบอท',
    sayTitle: 'ใช้บอทส่งข้อความ',
    sayText: 'ข้อความที่ต้องการให้บอทส่ง',
    sayImage: 'ลิ้งภาพ (ไม่บังคับ)',
    saySent: (ch) => `{ok} ส่งข้อความไปที่ <#${ch}> แล้ว`,
    sayFail: '{warn} ส่งไม่ได้ ตรวจสอบสิทธิ์ของบอทและของคุณในห้องนั้น',
  },
  en: {
    noPermMsg: '{warn} You need the Manage Messages permission to use this',
    purgeDone: (n) => `🗑️ Deleted ${n} message(s)`,
    purgeNone: '{info} Nothing to delete (messages older than 14 days cannot be deleted)',
    purgeFail: "{warn} Couldn't delete. Check my Manage Messages permission.",
    sayTitle: 'Send a message as the bot',
    sayText: 'Message for the bot to send',
    sayImage: 'Image URL (optional)',
    saySent: (ch) => `{ok} Message sent to <#${ch}>`,
    sayFail: "{warn} Couldn't send. Check my permissions and yours in that channel.",
  },
};
