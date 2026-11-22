'use strict';
const { db } = require('./db');
const { ex } = require('./emoji');

// ---------- ภาษาเซิร์ฟเวอร์ (TH/EN) ----------
const langOf = (gid) => (db[gid]?.lang === 'en' ? 'en' : 'th');

const TXT = require('./texts');

const tr = (gid, key, ...a) => {
  const v = TXT[langOf(gid)][key];
  return ex(typeof v === 'function' ? v(...a) : v);
};

module.exports = {
  langOf,
  TXT,
  tr,
};
