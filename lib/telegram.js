import { createHash } from "node:crypto";

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN o'rnatilmagan");
  return t;
}

export const ownerId = () => process.env.OWNER_ID?.trim() || "";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Telegram Bot API chaqiruvi. Xato bo'lsa exception tashlaydi. */
export async function tg(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

/** Fayl yuborish uchun multipart chaqiruv. */
export async function tgForm(method, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (v instanceof Blob) form.append(k, v, v.name ?? "file");
    else form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

/** PDF/hujjat yuborish. bcid berilsa — egasining nomidan (business chat). */
export async function sendDocument({ chatId, bcid, bytes, filename, caption, replyMarkup }) {
  const file = new File([bytes], filename, { type: "application/pdf" });
  return tgForm("sendDocument", {
    chat_id: chatId,
    business_connection_id: bcid,
    document: file,
    caption: caption?.slice(0, 1000),
    reply_markup: replyMarkup,
  });
}

/** Bot egasiga botning o'z chatida xabar. */
export async function notifyOwner(text, extra = {}) {
  if (!ownerId()) return;
  await tg("sendMessage", { chat_id: Number(ownerId()), text: text.slice(0, 4000), ...extra });
}

/** Faylni Telegram serveridan yuklab oladi (botlar uchun limit 20 MB). */
export async function downloadFile(fileId) {
  const f = await tg("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
  if (!res.ok) throw new Error(`Fayl yuklab bo'lmadi: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Webhook maxfiy kaliti bot tokenidan hosil qilinadi — alohida env kerak emas.
 * Token almashtirilsa, /api/setup ni qayta ochish kifoya.
 */
export function webhookSecret() {
  return createHash("sha256").update(`tg-webhook:${token()}`).digest("hex").slice(0, 48);
}

export function fullName(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.username ? `@${u.username}` : "Mijoz");
}

/** Bazada va AI'da matn sifatida ko'rinadigan qisqa tavsif. */
export function messageText(m) {
  const caption = m.caption ? ` ${m.caption}` : "";
  if (m.text) return m.text;
  if (m.photo) return `[rasm]${caption}`;
  if (m.voice) return "[ovozli xabar]";
  if (m.video_note) return "[dumaloq video]";
  if (m.video) return `[video]${caption}`;
  if (m.animation) return `[GIF]${caption}`;
  if (m.sticker) return `[stiker ${m.sticker.emoji ?? ""}]`.replace(" ]", "]");
  if (m.document) return `[fayl: ${m.document.file_name ?? "nomsiz"}]${caption}`;
  if (m.audio) return `[audio]${caption}`;
  if (m.location) return "[joylashuv]";
  if (m.contact) return `[kontakt: ${m.contact.phone_number}]`;
  return "[xabar]";
}

// ---------- Xavfsizlik: havolalar va xavfli fayllar ----------

const DANGEROUS_EXT = new Set([
  "apk", "apks", "xapk", "aab", "exe", "msi", "bat", "cmd", "com", "scr", "pif", "jar",
  "js", "jse", "vbs", "vbe", "wsf", "ps1", "sh", "lnk", "hta", "html", "htm", "svg",
  "zip", "rar", "7z", "tar", "gz", "iso", "img", "dmg", "pkg", "deb", "ipa",
]);

export function hasLink(m) {
  const ents = [...(m.entities ?? []), ...(m.caption_entities ?? [])];
  if (ents.some((e) => e.type === "url" || e.type === "text_link")) return true;
  return /(https?:\/\/|www\.)\S+/i.test(m.text ?? m.caption ?? "");
}

export function dangerousFile(m) {
  const name = m.document?.file_name?.toLowerCase();
  if (!name || !name.includes(".")) return false;
  return DANGEROUS_EXT.has(name.split(".").pop());
}

/** "havola" | "fayl" | null */
export function dangerKind(m) {
  if (dangerousFile(m)) return "fayl";
  if (hasLink(m)) return "havola";
  return null;
}

// ---------- Media ma'lumoti (bazada saqlanadi, keyin yuklab olinadi) ----------

export function mediaInfo(m) {
  const pick = (kind, f, mime) =>
    f?.file_id ? { kind, file_id: f.file_id, mime, size: f.file_size ?? 0, name: f.file_name ?? null } : null;

  if (m.photo?.length) return pick("image", m.photo[m.photo.length - 1], "image/jpeg");
  if (m.voice) return pick("audio", m.voice, m.voice.mime_type || "audio/ogg");
  if (m.audio) return pick("audio", m.audio, m.audio.mime_type || "audio/mpeg");
  if (m.video) return pick("video", m.video, m.video.mime_type || "video/mp4");
  if (m.video_note) return pick("video", m.video_note, "video/mp4");
  if (m.animation) return pick("video", m.animation, m.animation.mime_type || "video/mp4");
  if (m.sticker && !m.sticker.is_animated && !m.sticker.is_video) return pick("image", m.sticker, "image/webp");
  if (m.document) {
    const mime = m.document.mime_type || "application/octet-stream";
    let kind = "other";
    if (mime.startsWith("image/")) kind = "image";
    else if (mime.startsWith("video/")) kind = "video";
    else if (mime.startsWith("audio/")) kind = "audio";
    else if (mime === "application/pdf") kind = "pdf";
    else if (mime.startsWith("text/") || /json|csv|xml/.test(mime)) kind = "text";
    return pick(kind, m.document, mime);
  }
  return null;
}
