'use strict';
/*
 * ตรวจก่อน push:  npm run check
 *  1) ทุกไฟล์ .js ผ่าน node --check (ไวยากรณ์ถูก)
 *  2) ไม่มีไฟล์ลับ (.env, data.json) อยู่ใน git
 *  3) ไม่มีโทเคนบอท Discord หลุดอยู่ในไฟล์ที่ git จะเก็บ
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const fail = (m) => { failed++; console.log('✗ ' + m); };

// 1) ไวยากรณ์
const jsFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
};
walk(root);
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax error: ${path.relative(root, f)}\n${r.stderr}`);
}
console.log(`ตรวจไวยากรณ์ ${jsFiles.length} ไฟล์`);

// 2) + 3) ไฟล์ที่ git ติดตามอยู่ / กำลังจะติดตาม
let files = [];
let inGit = true;
try {
  files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);
} catch {
  inGit = false;
  console.log('(ยังไม่ใช่ git repo — ข้ามการตรวจรายการไฟล์ที่ git เก็บ แต่จะสแกนทั้งโฟลเดอร์แทน)');
  const all = [];
  const w2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) w2(p); else all.push(path.relative(root, p)); } };
  w2(root);
  files = all.filter((f) => !['.env', 'data.json'].includes(f));
}
for (const f of files) {
  if (f === '.env' || f === 'data.json' || /^\.env\./.test(f) && f !== '.env.example') fail(`ไฟล์ลับถูก git เก็บ: ${f}`);
}
// โทเคนบอท: base64(id).เวลา.hmac
const TOKEN_RE = /[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}/;
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p) || fs.statSync(p).size > 2_000_000) continue;
  const text = fs.readFileSync(p, 'utf8');
  if (TOKEN_RE.test(text)) fail(`เจอสิ่งที่หน้าตาเหมือนโทเคนบอทใน ${f}`);
  if (/^\s*TOKEN\s*=\s*[^\s#]{20,}/m.test(text) && f !== '.env') fail(`เจอ TOKEN=... ที่มีค่าจริงใน ${f}`);
}
if (inGit && !fs.existsSync(path.join(root, '.gitignore'))) fail('ไม่มี .gitignore');

if (failed) { console.log(`\nไม่ผ่าน ${failed} รายการ — ห้าม push จนกว่าจะแก้`); process.exit(1); }
console.log('✓ ผ่านทุกการตรวจ (ไวยากรณ์ + ไม่มีไฟล์ลับ/โทเคน)');
