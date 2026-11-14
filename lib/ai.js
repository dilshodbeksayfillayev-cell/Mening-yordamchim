// OpenRouter orqali tuzilgan (JSON) javoblar (OpenAI-mos chat/completions API).
import { getAiKey } from "./settings.js";

/** AI kaliti yo'q yoki noto'g'ri bo'lsa — egasiga tushunarli xabar uchun alohida xato turi. */
export class AiKeyError extends Error {}

const DEFAULT_MODEL = "google/gemini-3.8-flash";

export const ALERTS = ["none", "buyurtma", "shikoyat", "shoshilinch", "javobsiz_savol"];

const strictSchema = (name, properties) => ({
  type: "json_schema",
  json_schema: {
    name,
    strict: true,
    schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  },
});

// Mijozga javob.
const CLIENT_FORMAT = strictSchema("client_reply", {
  reply: { type: "string", description: "Mijozga yuboriladigan matn (PDF bo'lsa — unga izoh)" },
  action: { type: "string", enum: ["reply", "handoff"] },
  alert: { type: "string", enum: ALERTS },
  task: { type: "string", enum: ["none", "images_to_pdf"], description: "Bajariladigan vazifa" },
  file_name: { type: "string", description: "PDF fayl nomi (task bo'lmasa bo'sh)" },
  note: { type: "string", description: "Egasi uchun bir gaplik o'zbekcha izoh" },
});

// Egasining buyruqlari.
export const OWNER_COMMANDS = [
  "none", "set_profile", "append_profile", "set_work_hours", "work_hours_off", "report",
  "list_chats", "send_to_chat", "resume_chat", "mute_chat", "images_to_pdf",
  "set_auto_send", "set_memory", "pause_bot", "resume_bot", "test_reply", "set_quiet", "set_reply_delay",
];
const OWNER_FORMAT = strictSchema("owner_command", {
  reply: { type: "string", description: "Egasiga javob matni" },
  command: { type: "string", enum: OWNER_COMMANDS },
  text: { type: "string", description: "Buyruq matni: profil, xabar, ish vaqti (09:00-18:00 1-5) yoki sinov xabari" },
  chat_id: { type: "string", description: "Chat ID (ro'yxatdan), aks holda bo'sh" },
  value: { type: "boolean", description: "Yoqish/o'chirish buyruqlari uchun" },
  file_name: { type: "string", description: "PDF nomi yoki bo'sh" },
});

export function currentModel() {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

async function complete({ system, messages, format }) {
  const key = (await getAiKey())?.key;
  if (!key) throw new AiKeyError("AI kaliti kiritilmagan");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "X-Title": "tg-business-bot",
    },
    body: JSON.stringify({
      model: currentModel(),
      max_tokens: 8000,
      reasoning: { effort: process.env.AI_REASONING || "low", exclude: true },
      response_format: format,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const msg = `OpenRouter ${res.status}: ${data?.error?.message ?? "noma'lum xato"}`;
    // 401 — kalit noto'g'ri, 402 — hisobda pul tugagan.
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new AiKeyError(msg);
    throw new Error(msg);
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const raw = (Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : content ?? "").trim();
  if (!raw) {
    console.warn("OpenRouter bo'sh javob", choice?.finish_reason);
    return null;
  }
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { reply: raw }; // JSON bo'lmasa — matnni javob deb olamiz
  }
}

/** Mijozga javob: { reply, action, alert, task, file_name, note } yoki null. */
export async function generateReply({ system, messages }) {
  const out = await complete({ system, messages, format: CLIENT_FORMAT });
  const reply = String(out?.reply ?? "").trim().slice(0, 4000);
  if (!reply) return null;
  return {
    reply,
    action: out.action === "handoff" ? "handoff" : "reply",
    alert: ALERTS.includes(out.alert) ? out.alert : "none",
    task: out.task === "images_to_pdf" ? "images_to_pdf" : "none",
    file_name: String(out.file_name ?? ""),
    note: String(out.note ?? "").slice(0, 500),
  };
}

/** Egasi buyrug'ini tushunish: { reply, command, text, chat_id, value, file_name }. */
export async function parseOwnerCommand({ system, messages }) {
  const out = await complete({ system, messages, format: OWNER_FORMAT });
  if (!out) return null;
  return {
    reply: String(out.reply ?? "").trim().slice(0, 4000),
    command: OWNER_COMMANDS.includes(out.command) ? out.command : "none",
    text: String(out.text ?? ""),
    chat_id: String(out.chat_id ?? "").trim(),
    value: Boolean(out.value),
    file_name: String(out.file_name ?? ""),
  };
}
