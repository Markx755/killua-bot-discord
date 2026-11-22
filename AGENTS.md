# คำแนะนำสำหรับ AI agent ในโปรเจกต์นี้

- จะ **push ขึ้น GitHub** → ทำตาม [`docs/AGENT_PUSH_GUIDE.md`](docs/AGENT_PUSH_GUIDE.md) ทุกขั้น
- จะ **แก้โค้ด** → 1 ระบบ = 1 ไฟล์ใน `src/features/` (โครงสร้างอยู่ในคู่มือหัวข้อ 1) ข้อความ TH/EN อยู่ใน `src/texts/`
- **ก่อน commit ทุกครั้ง** รัน `npm run ci` ต้องผ่าน
- ห้าม commit `.env` / `data.json` และห้ามแสดงโทเคนในแชทหรือ log
- ห้ามเพิ่มระบบ "บอททำเควสอัตโนมัติ" (self-bot) — เจ้าของโปรเจกต์ตัดสินใจไม่ทำ เพราะผิดกฎของ Discord
