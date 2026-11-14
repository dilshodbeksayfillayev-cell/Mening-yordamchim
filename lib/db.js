// Supabase REST: chat tarixi, sozlamalar, chat holati.
// Ixtiyoriy: kalit kiritilmasa bot bazasiz ishlaydi (profil tahriri, ish vaqti, chatlar, hisobot — yo'q).

export const dbEnabled = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function rest(table, query = "", init = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY o'rnatilmagan");
  const headers = { apikey: key, "content-type": "application/json", ...init.headers };
  // Eski JWT kalitlar Authorization sarlavhasini ham talab qiladi; yangi sb_secret_ kalitlar — yo'q.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}${query}`, { ...init, headers });
  if (!res.ok) throw new Error(`Supabase ${table} ${res.status}: ${await res.text()}`);
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

const upsert = (table, conflict, row) =>
  rest(table, `?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });

// ---------- Xabarlar ----------

export async function saveMessage({ chatId, role, content, tgMessageId = null, fromName = null, flag = null, media = null }) {
  const rows = await rest("tgb_messages", "?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      chat_id: chatId, role, content, tg_message_id: tgMessageId, from_name: fromName, flag, media,
    }),
  });
  return rows[0].id;
}

export async function lastRow(chatId) {
  const rows = await rest("tgb_messages", `?chat_id=eq.${chatId}&select=id,role&order=id.desc&limit=1`);
  return rows[0] ?? null;
}

/** Oxirgi `limit` ta xabar, eskidan yangiga. */
export async function history(chatId, limit = 50) {
  const rows = await rest(
    "tgb_messages",
    `?chat_id=eq.${chatId}&select=role,content,media,from_name,flag,created_at&order=id.desc&limit=${limit}`,
  );
  return rows.reverse();
}

/** Oxirgi javobdan keyin kelgan (javobsiz) mijoz xabarlari. */
export async function pendingUserRows(chatId) {
  const rows = await rest("tgb_messages", `?chat_id=eq.${chatId}&select=role,content,media&order=id.desc&limit=20`);
  const out = [];
  for (const r of rows) {
    if (r.role !== "user") break;
    out.push(r);
  }
  return out.reverse();
}

/** Oxirgi PDF yuborilganidan keyin chatga kelgan rasmlar (eskidan yangiga, ko'pi bilan 30 ta). */
export async function imagesSinceLastPdf(chatId) {
  const rows = await rest("tgb_messages", `?chat_id=eq.${chatId}&select=role,media,flag&order=id.desc&limit=80`);
  const out = [];
  for (const r of rows) {
    if (r.flag?.split(",").includes("pdf")) break;
    if (r.role === "user" && r.media?.kind === "image") out.push(r.media);
  }
  return out.reverse().slice(-30);
}

export async function messagesSince(iso) {
  return rest(
    "tgb_messages",
    `?created_at=gte.${encodeURIComponent(iso)}&select=chat_id,role,content,from_name,flag,created_at&order=id.asc&limit=3000`,
  );
}

// ---------- Sozlamalar (profil, ish vaqti, bayroqlar) ----------

export async function kvGet(key) {
  const rows = await rest("tgb_kv", `?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows[0]?.value ?? null;
}

export async function kvSet(key, value) {
  await upsert("tgb_kv", "key", { key, value, updated_at: new Date().toISOString() });
}

export async function kvDelete(key) {
  await rest("tgb_kv", `?key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
}

// ---------- Chatlar ----------

const CHAT_COLS = "chat_id,name,handoff,handoff_at,muted,last_message_at";

export async function chatGet(chatId) {
  if (!/^-?\d+$/.test(String(chatId).trim())) return null; // AI yoki tugmadan kelgan noto'g'ri ID
  const rows = await rest("tgb_chats", `?chat_id=eq.${chatId}&select=${CHAT_COLS}`);
  return rows[0] ?? null;
}

export async function chatSet(chatId, fields) {
  await upsert("tgb_chats", "chat_id", { chat_id: chatId, ...fields, updated_at: new Date().toISOString() });
}

export async function recentChats(limit = 10) {
  return rest("tgb_chats", `?select=${CHAT_COLS}&order=last_message_at.desc.nullslast&limit=${limit}`);
}

export async function handoffChats() {
  return rest("tgb_chats", `?handoff=is.true&select=${CHAT_COLS}&order=handoff_at.desc&limit=50`);
}
