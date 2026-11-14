// Profil, ish vaqti va bot bayroqlari: avval bazadan, bo'lmasa profile.md / env.
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbEnabled, kvGet, kvSet, kvDelete } from "./db.js";

export const TZ = () => process.env.TZ_NAME || "Asia/Tashkent";

let fileProfile;
export function defaultProfile() {
  if (fileProfile === undefined) {
    try {
      fileProfile = readFileSync(path.join(process.cwd(), "profile.md"), "utf8");
    } catch {
      fileProfile = "";
    }
  }
  return fileProfile;
}

export async function getProfile() {
  if (dbEnabled()) {
    const v = await kvGet("profile").catch(() => null);
    if (v?.text) return v.text;
  }
  return defaultProfile();
}

// ---------- AI (OpenRouter) kaliti: bot sozlamalarida saqlangani ustun, bo'lmasa Vercel env ----------

let keyCache = { at: 0, value: undefined };

/** { key, source: "bot" | "vercel" } yoki null. */
export async function getAiKey() {
  if (dbEnabled()) {
    if (Date.now() - keyCache.at > 30e3) {
      const v = await kvGet("ai_key").catch(() => null);
      keyCache = { at: Date.now(), value: v?.key || null };
    }
    if (keyCache.value) return { key: keyCache.value, source: "bot" };
  }
  const env = process.env.OPENROUTER_API_KEY?.trim();
  return env ? { key: env, source: "vercel" } : null;
}

export async function setAiKey(key) {
  if (key) await kvSet("ai_key", { key, set_at: new Date().toISOString() });
  else await kvDelete("ai_key");
  keyCache = { at: 0, value: undefined };
}

export const maskKey = (k) => (k ? `${k.slice(0, 9)}…${k.slice(-4)}` : "yo'q");

export const looksLikeOpenRouterKey = (s) => /^sk-or-v1-[A-Za-z0-9]{20,}$/.test(String(s).trim());

/** OpenRouter kalitini tekshiradi (pul sarflamaydi). */
export async function checkOpenRouterKey(key) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "OpenRouter bu kalitni qabul qilmadi" };
    if (!r.ok) return { ok: true, warn: `tekshirib bo'lmadi (${r.status}), baribir saqlandi` };
    const d = (await r.json())?.data ?? {};
    return { ok: true, remaining: d.limit_remaining ?? null, usage: d.usage ?? null };
  } catch {
    return { ok: true, warn: "OpenRouter'ga ulanib bo'lmadi, baribir saqlandi" };
  }
}

// ---------- Bayroqlar: avto-javob, xotira, pauza, kutish, jimlik ----------
// Bazada { auto_send, memory, paused, delay_seconds, quiet_seconds } saqlanadi; yo'q bo'lsa env qiymatlari.

const envBool = (name, def) => (process.env[name] ?? String(def)).toLowerCase() === "true";
const envNum = (name, def) => {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) && n >= 0 ? n : def;
};

/** Javobdan oldin kutish chegarasi (Vercel funksiyasi 120 s ichida tugashi kerak). */
export const MAX_DELAY_SECONDS = 60;
export const MAX_QUIET_SECONDS = 24 * 3600;

export async function getFlags() {
  const base = {
    auto_send: envBool("AUTO_SEND", true),
    memory: envBool("CHAT_MEMORY", false),
    paused: false,
    // Mijoz yozgach, javobdan oldin kutish (shu orada yana yozsa — hammasiga bitta javob).
    delay_seconds: Math.min(MAX_DELAY_SECONDS, envNum("DEBOUNCE_MS", 5000) / 1000),
    // Egasi chatga o'zi yozgach, bot o'sha chatda shuncha soniya jim turadi.
    quiet_seconds: envNum("OWNER_QUIET_MINUTES", 10) * 60,
  };
  if (!dbEnabled()) return base;
  const saved = { ...((await kvGet("flags").catch(() => null)) ?? {}) };
  // Eski versiya daqiqada saqlagan.
  if (saved.quiet_seconds === undefined && typeof saved.quiet_minutes === "number") saved.quiet_seconds = saved.quiet_minutes * 60;
  delete saved.quiet_minutes;
  return { ...base, ...saved };
}

/** "90", "2 daqiqa", "1 daq 30 s", "1m", "45 soniya" → soniya yoki null. Birlik yozilmasa — soniya. */
export function parseDuration(text) {
  const s = String(text).toLowerCase().replace(",", ".");
  if (/^\s*(yo'?q|o'?chir|off)\s*$/.test(s)) return 0;
  const re = /(\d+(?:\.\d+)?)\s*(soat|h|daqiqa|daq|minut|min|m|soniya|sekund|sek|sec|s)?/g;
  let total = 0;
  let found = false;
  for (const [, num, unit = "s"] of s.matchAll(re)) {
    found = true;
    const k = /^(soat|h)$/.test(unit) ? 3600 : /^(daqiqa|daq|minut|min|m)$/.test(unit) ? 60 : 1;
    total += Number(num) * k;
  }
  return found ? Math.round(total) : null;
}

/** 0 → "o'chiq", 45 → "45 soniya", 90 → "1 daqiqa 30 soniya", 3600 → "1 soat". */
export function formatDuration(sec) {
  if (!sec) return "o'chiq";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h && `${h} soat`, m && `${m} daqiqa`, s && `${s} soniya`].filter(Boolean).join(" ");
}

export async function setFlag(name, value) {
  const flags = await getFlags();
  flags[name] = value;
  await kvSet("flags", flags);
  return flags;
}

// ---------- Ish vaqti ----------
// Saqlanadigan ko'rinish: { start: 540, end: 1080, days: [1,2,3,4,5] } (daqiqalarda, 1 = dushanba)

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DAY_NAMES = ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function localNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(), weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get("hour")) % 24;
  return { day: WEEKDAYS[get("weekday")], minutes: hour * 60 + Number(get("minute")) };
}

export function isWithin(wh, now = localNow()) {
  if (!wh) return false;
  const { start, end, days } = wh;
  if (start <= end) return days.includes(now.day) && now.minutes >= start && now.minutes < end;
  // tungi smena, masalan 22:00-06:00
  const prev = now.day === 1 ? 7 : now.day - 1;
  return (days.includes(now.day) && now.minutes >= start) || (days.includes(prev) && now.minutes < end);
}

export async function getWorkHours() {
  if (!dbEnabled()) return null;
  return kvGet("work_hours").catch(() => null);
}

/** "09:00-18:00 1-5" → obyekt yoki null. Kunlar ko'rsatilmasa — har kuni. */
export function parseWorkHours(text) {
  const m = String(text)
    .trim()
    .match(/^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})(?:\s+([1-7](?:-[1-7])?(?:,[1-7](?:-[1-7])?)*))?$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1, 5).map(Number);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const days = new Set();
  for (const part of (m[5] ?? "1-7").split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    for (let d = Math.min(a, b); d <= Math.max(a, b); d++) days.add(d);
  }
  return { start: h1 * 60 + m1, end: (h2 * 60 + m2) % 1440, days: [...days].sort() };
}

export function formatWorkHours(wh) {
  if (!wh) return "o'chirilgan (bot har doim javob beradi)";
  const t = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return `${t(wh.start)}–${t(wh.end)}, ${wh.days.map((d) => DAY_NAMES[d]).join(", ")} (${TZ()})`;
}
