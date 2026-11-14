// Kunlik hisobot: oxirgi 24 soatda kim yozdi, nima javobsiz qoldi, qanday ogohlantirishlar bo'ldi.
import { messagesSince, handoffChats } from "./db.js";

const FLAG_LABELS = {
  buyurtma: "🛒 buyurtma",
  shikoyat: "😠 shikoyat",
  shoshilinch: "🚨 shoshilinch",
  javobsiz_savol: "❓ javob topilmadi",
  handoff: "🙋 sizga uzatildi",
  "xavfli:havola": "🔗 havola",
  "xavfli:fayl": "⚠️ xavfli fayl",
  pdf: "📄 PDF qilib berildi",
};

const snip = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function buildReport(hours = 24) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = await messagesSince(since);

  const chats = new Map();
  let botReplies = 0;
  let ownerReplies = 0;
  for (const r of rows) {
    if (r.from_name === "owner_dm") continue; // egasining bot bilan shaxsiy yozishmasi
    const c = chats.get(r.chat_id) ?? { name: null, userCount: 0, lastRole: null, lastUserText: "", flags: new Set() };
    if (r.role === "user") {
      c.userCount++;
      c.lastUserText = r.content;
      if (r.from_name) c.name = r.from_name;
    } else if (r.from_name === "bot") botReplies++;
    else ownerReplies++;
    if (r.flag) for (const f of r.flag.split(",")) c.flags.add(f);
    c.lastRole = r.role;
    chats.set(r.chat_id, c);
  }

  const active = [...chats.values()].filter((c) => c.userCount > 0);
  const unanswered = active.filter((c) => c.lastRole === "user");
  const flagged = active.filter((c) => c.flags.size);
  const userMsgs = active.reduce((s, c) => s + c.userCount, 0);

  const lines = [
    `📊 Hisobot — oxirgi ${hours} soat`,
    "",
    `👥 Yozganlar: ${active.length} kishi, ${userMsgs} ta xabar`,
    `🤖 Bot javoblari: ${botReplies}`,
    `🙋 Siz yozgan javoblar: ${ownerReplies}`,
  ];

  if (flagged.length) {
    lines.push("", "🔔 Muhim:");
    for (const c of flagged.slice(0, 15)) {
      const labels = [...c.flags].map((f) => FLAG_LABELS[f] ?? f).join(", ");
      lines.push(`• ${c.name ?? "Noma'lum"} — ${labels}`);
    }
  }

  if (unanswered.length) {
    lines.push("", "⏳ Javobsiz qolganlar:");
    for (const c of unanswered.slice(0, 15)) lines.push(`• ${c.name ?? "Noma'lum"}: "${snip(c.lastUserText)}"`);
  }

  const handed = await handoffChats().catch(() => []);
  if (handed.length) {
    lines.push("", `🙋 Sizni kutayotgan chatlar (bot jim): ${handed.length}`);
    for (const h of handed.slice(0, 10)) lines.push(`• ${h.name ?? h.chat_id}`);
  }

  if (!active.length) lines.push("", "Bu davrda hech kim yozmadi.");
  return lines.join("\n");
}
