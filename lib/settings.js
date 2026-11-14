// Profil, ish vaqti va bot bayroqlari: avval bazadan, bo'lmasa profile.md / env.
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbEnabled, kvGet, kvSet } from "./db.js";

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

// ---------- Bayroqlar: avto-javob, xotira, pauza, jimlik ----------
// Bazada { auto_send, memory, paused, quiet_minutes } saqlanadi; yo'q bo'lsa env qiymatlari.

const envBool = (name, def) => (process.env[name] ?? String(def)).toLowerCase() === "true";

/** Egasi chatga o'zi yozgach, bot shu chatda necha daqiqa jim turadi. */
export const QUIET_STEPS = [0, 5, 10, 30, 60];

export async function getFlags() {
  const quiet = Number(process.env.OWNER_QUIET_MINUTES ?? 10);
  const base = {
    auto_send: envBool("AUTO_SEND", true),
    memory: envBool("CHAT_MEMORY", false),
    paused: false,
    quiet_minutes: Number.isFinite(quiet) && quiet >= 0 ? quiet : 10,
  };
  if (!dbEnabled()) return base;
  const saved = await kvGet("flags").catch(() => null);
  return { ...base, ...(saved ?? {}) };
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
