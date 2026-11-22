# คู่มือสำหรับเอเจนต์: push Killua Bot ขึ้น GitHub

เอกสารนี้เขียนให้ AI agent (หรือคนที่ทำตามทีละขั้น) ใช้ push โปรเจกต์นี้ขึ้น GitHub อย่างปลอดภัย
อ่านกฎเหล็กก่อน แล้วทำตามขั้นตอนตามลำดับ **ห้ามข้ามขั้นตอนตรวจสอบ**

---

## 0) กฎเหล็ก (ห้ามฝ่าฝืน)

1. **ห้าม commit `.env` และ `data.json`** — `.env` มีโทเคนบอท, `data.json` มีข้อมูลทุกเซิร์ฟเวอร์ (ทั้งคู่อยู่ใน `.gitignore` แล้ว)
2. **ห้ามพิมพ์/แสดง/บันทึกโทเคนบอทหรือ GitHub token** ในแชท, commit message, log หรือไฟล์ใดๆ
3. **ห้าม `git push --force`** ไปที่ `main` ยกเว้นเจ้าของสั่งเป็นข้อความชัดเจน
4. **ห้ามใช้ `git add -A` / `git add .` โดยไม่ดูผล `git status` ก่อน** (ใช้ได้เมื่อ `.gitignore` ถูกต้องและตรวจแล้ว)
5. รัน `npm run ci` ให้ผ่านก่อน push ทุกครั้ง ถ้าไม่ผ่านให้แก้ ไม่ใช่ข้ามไป
6. ถ้าเจอโทเคนหลุดในไฟล์หรือประวัติ git → **หยุด** แจ้งเจ้าของให้กด Reset Token ที่ Discord Developer Portal ทันที แล้วค่อยล้างประวัติ (ดูหัวข้อ 7)

---

## 1) โครงสร้างโปรเจกต์ (อ่านก่อนแก้อะไร)

```
index.js                 จุดเริ่มต้น: โหลดทุกระบบ ลงทะเบียนคำสั่ง ส่ง interaction ไปหาระบบที่ใช่
src/
  client.js              discord.js Client ตัวเดียวของทั้งบอท
  config.js              ค่าคงที่ (BOT_NAME)
  db.js                  data.json: db, save(), getCfg()   (ที่เก็บแก้ได้ด้วย env DATA_FILE)
  emoji.js               ตารางอิโมจิเซิร์ฟเวอร์: EMOJI, E, em(), ex()
  i18n.js                tr(guildId, key, ...args) เลือก TH/EN ตามเซิร์ฟเวอร์
  texts/                 ข้อความ TH/EN แยกตามระบบ (index.js รวมให้)
  ui.js                  ตัวช่วยสร้างแผง Components V2 (v2Text, ephV2, modalInput, imgButton ...)
  log.js                 log แบบ UI V2: logPayload(), sendLog(), sendLogTo()
  killua-logs.js         หมวดส่วนตัว 𝗞𝗶𝗹𝗹𝘂𝗮 - 𝗟𝗼𝗴𝘀 (4 ห้อง) ใช้ร่วมกันทุกระบบ
  features/              1 ไฟล์ = 1 ระบบ
    voice.js stats.js antispam.js verify.js language.js
    images.js tools.js create.js trap.js announce.js antinuke.js onboarding.js
test/                    เทสต์ด้วย discord.js ปลอม (ไม่ใช้เน็ต/โทเคน)
scripts/check.js         ตรวจไวยากรณ์ + ไฟล์ลับ + โทเคนหลุด
scripts/check-imports.js ตรวจว่าไม่มีตัวแปรที่ลืม require
docs/AGENT_PUSH_GUIDE.md ไฟล์นี้
```

ทุกไฟล์ใน `src/features/` export รูปแบบเดียวกัน:

| export | ความหมาย |
|---|---|
| `commands` | รายการ slash command (JSON) ของระบบนั้น (ไม่มีก็ได้) |
| `handleInteraction(i)` | คืน `true` ถ้ารับ interaction นี้ไปจัดการแล้ว, `false` ถ้าไม่ใช่ของระบบนี้ |
| `onReady()` | งานที่ต้องทำเมื่อบอทออนไลน์ (ตั้ง interval ฯลฯ) |

**เพิ่มระบบใหม่:** สร้าง `src/features/<ชื่อ>.js` → ใส่ข้อความใน `src/texts/<ชื่อ>.js` และเพิ่มชื่อใน `src/texts/index.js`
→ เพิ่ม `require('./src/features/<ชื่อ>')` ในรายการ `features` ของ `index.js`
→ ถ้ามีปุ่ม "ตั้งภาพ" ให้เรียก `registerImagePanel(key, render)` จาก `features/images.js`

---

## 2) เตรียมเครื่อง

```bash
git --version          # ต้องมี git
gh --version           # ถ้ามี GitHub CLI จะง่ายที่สุด (ไม่มีก็ใช้ข้อ 4B)
node -v                # ต้อง >= 24.17 (เฉพาะตอนรันบอทจริง; เทสต์รันได้บน Node 22+)
```

ตั้งตัวตน git ถ้ายังไม่เคยตั้ง (ถามเจ้าของถ้าไม่รู้ชื่อ/อีเมล):

```bash
git config --global user.name  "ชื่อเจ้าของ"
git config --global user.email "อีเมลที่ผูกกับ GitHub"
```

## 3) ตรวจโปรเจกต์ก่อน push

```bash
cd killua
npm run ci
```

ต้องเห็น `✓ ผ่านทุกการตรวจ`, `✓ ตรวจ ... ไม่มีตัวแปรที่ลืม import`, และ `ALL ... PASSED` ครบทั้ง 3 ชุด
(`npm run ci` = `npm run check` + `npm test`) ถ้าล้ม ให้แก้ก่อน

## 4) สร้าง repo และ push ครั้งแรก

ถามเจ้าของ (หรืออ่านจากที่เขาบอก): **ชื่อ repo** (เช่น `killua-bot`) และ **public หรือ private** — ค่าเริ่มต้นแนะนำ **private**

### 4A) มี GitHub CLI (`gh`) และล็อกอินแล้ว (`gh auth status` ผ่าน)

```bash
git init -b main
git add .
git status                      # ดูรายการ: ต้องไม่มี .env / data.json / node_modules
git commit -m "Initial commit: Killua Bot"
gh repo create killua-bot --private --source=. --remote=origin --push
```

### 4B) ไม่มี `gh` — เจ้าของสร้าง repo เปล่าบนเว็บให้ก่อน

1. เจ้าของสร้าง repo ว่างที่ https://github.com/new (ไม่ติ๊ก Add README / .gitignore / license) แล้วส่ง URL มา
2. จากนั้น:

```bash
git init -b main
git add .
git status
git commit -m "Initial commit: Killua Bot"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

การยืนยันตัวตนตอน push ให้ใช้ **Personal Access Token ที่เจ้าของให้** (สิทธิ์ `repo`) เป็นรหัสผ่าน
หรือใช้ `gh auth login` / SSH key — **อย่าเขียน token ลงใน URL ของ remote ที่ค้างอยู่ในไฟล์ `.git/config`**
ถ้าจำเป็นต้องใส่ชั่วคราวให้ใช้ `git -c credential.helper= push https://<user>:<token>@github.com/<user>/<repo>.git main` แล้วอย่าบันทึกคำสั่งนั้นลงที่ไหน

### ตรวจหลัง push

```bash
git log --oneline -3
git ls-files | grep -E '(^|/)(\.env|data\.json)$' && echo "!! มีไฟล์ลับ" || echo "ไม่มีไฟล์ลับ OK"
```

แล้วแจ้งเจ้าของ: URL ของ repo + ยืนยันว่า `.env`/`data.json` ไม่ได้ขึ้น

## 5) งานประจำ: แก้โค้ดแล้ว push อีกครั้ง

```bash
git checkout -b feat/<ชื่องานสั้นๆ>     # หรือทำบน main ถ้าเจ้าของอนุญาต
# ... แก้โค้ด ...
npm run ci                               # ต้องผ่าน
git add <ไฟล์ที่แก้>                     # เลือกไฟล์ให้ตรง
git status
git commit -m "<ประเภท>: <สรุปสิ่งที่เปลี่ยน>"
git push -u origin HEAD
```

รูปแบบ commit message (ภาษาอังกฤษหรือไทยก็ได้ ขอให้สั้นและบอกว่าเปลี่ยนอะไร):
`feat: add ...` · `fix: ...` · `refactor: ...` · `docs: ...` · `test: ...`

ถ้าเจ้าของอยากได้ Pull Request: `gh pr create --fill` (ถ้าไม่มี `gh` ให้ส่งลิงก์ branch ให้เจ้าของเปิด PR เอง)

## 6) GitHub Actions

ไฟล์ `.github/workflows/ci.yml` จะรัน `npm run check` และ `npm test` ให้เองทุกครั้งที่ push/PR
เทสต์ใช้ discord.js ปลอม จึง **ไม่ต้องใส่ secret ใดๆ** ใน GitHub ห้ามเพิ่ม `TOKEN` ลงใน workflow
(ถ้าอยาก deploy อัตโนมัติ ค่อยคุยกับเจ้าของแยกต่างหาก และใช้ GitHub Secrets เท่านั้น)

## 7) ถ้าโทเคนหรือไฟล์ลับหลุดขึ้น GitHub

1. แจ้งเจ้าของทันที ให้ **Reset Token** ที่ Discord Developer Portal → Bot → Reset Token (ข้อนี้สำคัญที่สุด — token เก่าถือว่าใช้ไม่ได้แล้ว)
2. ลบไฟล์ออกจากการติดตามและ commit:
   ```bash
   git rm --cached .env data.json
   git commit -m "chore: stop tracking secret files"
   git push
   ```
3. ถ้าเจ้าของต้องการล้างประวัติ (ต้องได้รับอนุญาตเป็นข้อความ เพราะต้อง force push): ใช้ `git filter-repo --path .env --path data.json --invert-paths` แล้ว `git push --force-with-lease`
4. แต่ถึงล้างประวัติแล้ว ให้ถือว่า token เก่าหลุดไปแล้วเสมอ — Reset เท่านั้นที่ปลอดภัย

## 8) ปัญหาที่เจอบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `npm run check` ฟ้องไฟล์ลับ | ไฟล์นั้นถูก git ติดตาม: `git rm --cached <ไฟล์>` และเช็ก `.gitignore` |
| `check-imports` ฟ้อง "ใช้แต่ไม่ได้ประกาศ" | ลืม `require` ในไฟล์นั้น เพิ่มบรรทัด `const { ... } = require('...')` |
| `check-imports` บอกต้องรันด้วย `--expose-internals` | ใช้ `npm run check` (ใส่ flag ให้แล้ว) |
| `git push` โดนปฏิเสธ (non-fast-forward) | `git pull --rebase origin main` แล้ว push ใหม่ (ห้าม force) |
| `Permission denied` / `403` | token/สิทธิ์ไม่พอ ให้เจ้าของสร้าง PAT ใหม่ที่มีสิทธิ์ `repo` หรือเพิ่มเป็น collaborator |
| `remote origin already exists` | `git remote set-url origin <URL>` |
| `fatal: not a git repository` | ยังไม่ได้ `git init -b main` ในโฟลเดอร์ `killua` |
| รันบอทแล้วหา `data.json` ไม่เจอ | ปกติ — ไฟล์จะถูกสร้างเองเมื่อมีการตั้งค่าครั้งแรก (และไม่ขึ้น git) |

## 9) เช็กลิสต์ก่อนบอกเจ้าของว่า "เสร็จ"

- [ ] `npm run ci` ผ่านทั้งหมด
- [ ] `git status` สะอาด และ `git ls-files` ไม่มี `.env` / `data.json` / `node_modules`
- [ ] push สำเร็จ และเห็น commit บน GitHub
- [ ] แจ้ง URL repo ให้เจ้าของ พร้อมบอกว่าเป็น private/public
- [ ] ย้ำเจ้าของ: ถ้าเคยเอาโทเคนไปวางที่ไหนนอก `.env` ให้ Reset Token
