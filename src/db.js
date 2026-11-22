'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');

// ---------- เก็บข้อมูลต่อเซิร์ฟเวอร์ ----------
let db = {};

try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  db = {};
}

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const getCfg = (guildId) => (db[guildId] ??= { channelId: null, enabled: false });

module.exports = {
  DATA_FILE,
  db,
  save,
  getCfg,
};
