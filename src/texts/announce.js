'use strict';
// ข้อความ TH/EN ของระบบ: announce
// {ชื่อ} ในข้อความ = อิโมจิจาก src/emoji.js (ตาราง E)
module.exports = {
  th: {
    annNoPerm: '{warn} ต้องมีสิทธิ์ Mention Everyone ถึงจะประกาศได้',
    annNeedBotPerm: '{warn} ส่งประกาศในห้องนั้นไม่ได้ บอทต้องมีสิทธิ์ View / Send Messages / Mention Everyone ในห้องนั้น (และคุณต้องเห็นห้องนั้น)',
    annModalTitle: 'ประกาศถึงทุกคน (@everyone)',
    annLabelTitle: 'หัวข้อประกาศ',
    annLabelText: 'ข้อความประกาศ',
    annLabelImage: 'ลิ้งภาพ (ไม่บังคับ)',
    annBadImage: '{warn} ลิ้งภาพต้องขึ้นต้นด้วย http:// หรือ https://',
    annSent: (url) => `{ok} ส่งประกาศพร้อม @everyone แล้ว ${url}`,
    annFail: '{warn} ส่งประกาศไม่สำเร็จ ตรวจสอบสิทธิ์ของบอท',
    annBy: (id) => `ประกาศโดย <@${id}>`,
    annLogTitle: '{star} ส่งประกาศ @everyone',
    annLogBody: (u, ch, title, url) => `**ผู้ประกาศ:** <@${u}>\n**ห้อง:** <#${ch}>\n**หัวข้อ:** ${title}\n{bullet} Killua ส่งประกาศพร้อม @everyone แล้ว ${url}`,
  },
  en: {
    annNoPerm: '{warn} You need the Mention Everyone permission to make announcements',
    annNeedBotPerm: "{warn} I can't post there. I need View / Send Messages / Mention Everyone in that channel (and you must be able to see it).",
    annModalTitle: 'Announce to everyone (@everyone)',
    annLabelTitle: 'Announcement title',
    annLabelText: 'Announcement text',
    annLabelImage: 'Image URL (optional)',
    annBadImage: '{warn} The image URL must start with http:// or https://',
    annSent: (url) => `{ok} Announcement sent with @everyone ${url}`,
    annFail: "{warn} Couldn't send the announcement. Check my permissions.",
    annBy: (id) => `Announced by <@${id}>`,
    annLogTitle: '{star} @everyone announcement sent',
    annLogBody: (u, ch, title, url) => `**By:** <@${u}>\n**Channel:** <#${ch}>\n**Title:** ${title}\n{bullet} Killua posted the announcement with @everyone ${url}`,
  },
};
