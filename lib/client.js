// Mijozga javob yozishning umumiy qismlari: system prompt, xabarlarni yig'ish, PDF.
import { mediaPart } from "./media.js";
import { generateReply } from "./ai.js";
import { getProfile } from "./settings.js";
import { imagesToPdf, pdfFileName } from "./pdf.js";
import { dbEnabled, imagesSinceLastPdf } from "./db.js";

const MAX_MEDIA_PER_TURN = 4;

export const DANGER_REPLY = {
  havola: "Xavfsizlik uchun havolalarni ochmayman 🙏 Egasi o'zi ko'rib, sizga javob beradi.",
  fayl: "Xavfsizlik uchun bunday fayllarni ochmayman 🙏 Egasi o'zi ko'rib, sizga javob beradi.",
};

export const ALERT_LABELS = {
  buyurtma: "🛒 Buyurtma",
  shikoyat: "😠 Shikoyat",
  shoshilinch: "🚨 Shoshilinch",
  javobsiz_savol: "❓ Bot javob topa olmadi",
};

export async function clientSystemPrompt() {
  return `Siz Telegram akkaunt egasi nomidan uning shaxsiy chatlarida mijozlarga javob yozasiz va oddiy topshiriqlarni bajarasiz.
Quyida egasi haqidagi ma'lumot — faqat shunga tayaning.

<profil>
${await getProfile()}
</profil>

Javob qoidalari:
- Qisqa va tabiiy yozing, xuddi odam telefondan yozgandek: 1–3 gap, markdown va ro'yxatlarsiz.
- Mijoz qaysi tilda yozsa, o'sha tilda javob bering.
- Mijoz yuborgan rasm, ovozli xabar, video yoki hujjatni ko'rib/eshitib, mazmuniga qarab javob bering.
- Matn bilan bajariladigan so'rovlarni o'zingiz bajaring: tarjima, rasm/hujjatdagi matnni ko'chirish, qisqa xulosa, hisob-kitob.
- Mijoz rasmlarni PDF qilib berishni so'rasa: task = "images_to_pdf", file_name — mos nom, reply — PDF'ga qisqa izoh. Rasmlar chatda avvalroq yuborilgan bo'lishi mumkin — ularning hammasi PDF'ga kiradi.
- Profilda yo'q narx, muddat yoki va'dani o'ylab topmang.
- Tarixdagi "assistant" xabarlari egasining o'zi yoki siz avval yozgan javoblar — ularga zid gapirmang.
- Hech qanday havolani ochishni, fayl yuklashni yoki to'lov qilishni taklif qilmang.
- Agar sizdan to'g'ridan-to'g'ri bot yoki sun'iy intellekt ekaningizni so'rashsa, yolg'on gapirmang.

Maydonlar:
- action: "handoff" — javobni profildan topa olmasangiz, savol nozik bo'lsa (pul o'tkazish, chegirma kelishuvi, shaxsiy masala), mijoz egasining o'zini so'rasa yoki yuborilgan narsani tushunolmasangiz. Suhbat jiddiylashsa (tahdid, haqorat, janjal, sud yoki huquqiy masala, katta pul, sog'liq bilan bog'liq xavf) — albatta "handoff" va alert "shoshilinch". Handoff'da reply'da muloyimlik bilan egasi tez orada o'zi javob berishini ayting. Boshqa hollarda "reply".
- alert: "buyurtma" (sotib olish, buyurtma, band qilish istagi), "shikoyat", "shoshilinch", "javobsiz_savol" (javobni bilmadingiz), aks holda "none".
- task: "images_to_pdf" yoki "none".
- note: egasi uchun o'zbekcha bitta gap — mijoz nima istayapti.`;
}

/** Bazadagi qatorlardan AI xabarlarini yig'adi; oxirgi bir nechta media faylni biriktiradi. */
export async function buildMessages(rows) {
  const mediaRows = new Set(rows.filter((r) => r.role === "user" && r.media).slice(-MAX_MEDIA_PER_TURN));
  const out = [];
  for (const r of rows) {
    const parts = [{ type: "text", text: r.content }];
    if (mediaRows.has(r)) {
      const part = await mediaPart(r.media);
      if (part) parts.push(part);
    }
    const prev = out[out.length - 1];
    if (prev && prev.role === r.role) prev.parts.push(...parts);
    else out.push({ role: r.role, parts });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map(({ role, parts }) => ({
    role,
    content: role === "user" ? parts : parts.map((p) => p.text).join("\n"),
  }));
}

/** Bitta xabarga mijoz sifatida javob (egasi sinovi uchun). */
export async function previewClientReply({ text, media }) {
  const messages = await buildMessages([{ role: "user", content: text, media }]);
  return generateReply({ system: await clientSystemPrompt(), messages });
}

/**
 * Chatdagi rasmlardan PDF. Baza bo'lsa — oxirgi PDF'dan keyingi barcha rasmlar,
 * bo'lmasa — faqat joriy xabardagi rasm.
 */
export async function buildChatPdf({ chatId, currentMedia, fileName }) {
  let list = [];
  if (dbEnabled()) list = await imagesSinceLastPdf(chatId).catch(() => []);
  if (!list.length && currentMedia?.kind === "image") list = [currentMedia];
  if (!list.length) return null;
  const pdf = await imagesToPdf(list);
  return pdf ? { ...pdf, filename: pdfFileName(fileName) } : null;
}
