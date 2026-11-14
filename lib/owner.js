// Bot egasi uchun: tugmali menyu, oddiy so'z bilan buyruqlar (AI orqali), sinov va PDF.
import {
  tg, ownerId, sleep, messageText, mediaInfo, sendDocument,
} from "./telegram.js";
import {
  dbEnabled, saveMessage, lastRow, kvGet, kvSet, kvDelete, chatGet, chatSet, recentChats, history,
  imagesSinceLastPdf,
} from "./db.js";
import { parseOwnerCommand, currentModel } from "./ai.js";
import {
  getProfile, getFlags, setFlag, getWorkHours, parseWorkHours, formatWorkHours, QUIET_STEPS,
} from "./settings.js";
import { buildReport } from "./report.js";
import { previewClientReply, buildChatPdf } from "./client.js";
import { mediaPart } from "./media.js";

// ---------- Tugmalar ----------

export const KB = {
  report: "📊 Hisobot",
  chats: "💬 Chatlar",
  profile: "👤 Profil",
  wh: "🕘 Ish vaqti",
  settings: "⚙️ Sozlamalar",
  test: "🧪 Sinov",
  pdf: "📄 PDF",
  help: "❓ Yordam",
};

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: KB.report }, { text: KB.chats }],
    [{ text: KB.profile }, { text: KB.wh }],
    [{ text: KB.settings }, { text: KB.test }],
    [{ text: KB.pdf }, { text: KB.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Buyruq yozing yoki tugmani bosing",
};

// Javob kutiladigan savollar (ForceReply). Qaysi savolga javob ekanini matnidan bilamiz — holat saqlash shart emas.
const ASK = {
  profileNew: "✏️ Yangi profil matnini yozing",
  profileAdd: "➕ Profilga qo'shiladigan ma'lumotni yozing",
  wh: "🕘 Ish vaqtini yozing",
  test: "🧪 Mijoz o'rnida xabar yozing",
  reply: "✍️ Javob matnini yozing",
};

const NEED_DB = "Bu funksiya uchun Vercel'da SUPABASE_SERVICE_ROLE_KEY kiritilishi kerak (profil, ish vaqti, chatlar, hisobot shu yerda saqlanadi).";

const ik = (rows) => ({ inline_keyboard: rows });
const btn = (text, data) => ({ text, callback_data: data });

const say = (chatId, text, extra = {}) =>
  tg("sendMessage", { chat_id: chatId, text: String(text).slice(0, 4000), ...extra });

/** Inline tugmali xabarni yangilaydi (bir xil bo'lsa — jim). */
async function edit(msg, text, markup) {
  await tg("editMessageText", {
    chat_id: msg.chat.id, message_id: msg.message_id, text: text.slice(0, 4000), reply_markup: markup,
  }).catch(() => {});
}

const ask = (chatId, prompt, placeholder) =>
  say(chatId, prompt, { reply_markup: { force_reply: true, input_field_placeholder: placeholder } });

// ---------- Ekranlar ----------

async function statusLines() {
  const flags = await getFlags();
  return [
    `🤖 Bot: ${flags.paused ? "⏸ to'xtatilgan" : "▶️ ishlayapti"}`,
    `✍️ Avto-javob: ${flags.auto_send ? "yoqilgan" : "o'chiq (javob loyihalari sizga keladi)"}`,
    `🧠 Xotira: ${flags.memory ? "oxirgi 50 xabar" : "faqat javobsiz xabarlar"}`,
    `🤫 Siz chatda yozgach, bot o'sha chatda ${flags.quiet_minutes ? `${flags.quiet_minutes} daqiqa jim turadi` : "jim turmaydi"}`,
    `🕘 Ish vaqti: ${formatWorkHours(await getWorkHours())}`,
    `🧩 Model: ${currentModel()}`,
    `🗄 Baza: ${dbEnabled() ? "ulangan" : "ulanmagan — profil, ish vaqti, chatlar va hisobot ishlamaydi"}`,
  ];
}

const HELP = `❓ Qanday foydalaniladi

Pastdagi tugmalar:
📊 Hisobot — oxirgi 24 soat: kim yozdi, nima javobsiz qoldi
💬 Chatlar — mijozlar ro'yxati; chatni ochib, javob yozish yoki botni o'sha chatda yoqish/o'chirish
👤 Profil — bot mijozlarga aytadigan ma'lumot (narx, ish vaqti, manzil)
🕘 Ish vaqti — shu vaqtda bot jim, siz o'zingiz javob berasiz
⚙️ Sozlamalar — avto-javob, xotira, botni to'xtatish
🧪 Sinov — mijoz o'rnida yozib, bot qanday javob berishini ko'rasiz
📄 PDF — rasmlarni shu yerga yuboring, PDF qilib beraman

Yoki oddiy so'z bilan buyuring:
• «Ish vaqtimni 9 dan 18 gacha qil, dushanbadan jumagacha»
• «Profilimga qo'sh: yetkazib berish bepul»
• «Alisherga yoz: buyurtmangiz tayyor»
• «Botni to'xtat» / «botni yoq»
• «Men yozgach 30 daqiqa jim tur»
• Rasmlar yuborib: «PDF qil»

Mijozlar ham bot orqali rasmlarini PDF qildirishi mumkin. Jiddiy holatda (shikoyat, janjal, katta pul) bot suhbatni sizga uzatadi va shu yerga xabar beradi.`;

async function showWelcome(chatId) {
  await say(
    chatId,
    ["👋 Salom! Men sizning Telegram yordamchingizman.", "", ...(await statusLines()), "", "Pastdagi tugmalardan foydalaning yoki menga oddiy so'z bilan buyruq bering. Batafsil: ❓ Yordam"].join("\n"),
    { reply_markup: MAIN_KEYBOARD },
  );
}

async function showReport(chatId) {
  if (!dbEnabled()) return say(chatId, NEED_DB);
  await say(chatId, await buildReport(), {
    reply_markup: ik([[btn("💬 Chatlar", "m:chats"), btn("🔄 Yangilash", "m:report")]]),
  });
}

const chatBadge = (c) => (c.muted ? "🔇" : c.handoff ? "🙋" : "🤖");

async function chatsScreen() {
  const chats = await recentChats(10);
  if (!chats.length) return { text: "💬 Hozircha mijozlar yozmagan.", markup: undefined };
  const text = [
    "💬 Oxirgi chatlar",
    "🤖 — bot javob beradi, 🙋 — sizni kutyapti, 🔇 — bot jim",
    "",
    "Chatni tanlang:",
  ].join("\n");
  const rows = chats.map((c) => [btn(`${chatBadge(c)} ${c.name ?? c.chat_id}`, `c:${c.chat_id}`)]);
  rows.push([btn("🔄 Yangilash", "m:chats")]);
  return { text, markup: ik(rows) };
}

async function showChats(chatId, msg) {
  if (!dbEnabled()) return say(chatId, NEED_DB);
  const { text, markup } = await chatsScreen();
  return msg ? edit(msg, text, markup) : say(chatId, text, { reply_markup: markup });
}

async function chatCard(targetId) {
  const c = await chatGet(targetId);
  if (!c) return { text: "Chat topilmadi.", markup: ik([[btn("⬅️ Chatlar", "m:chats")]]) };
  const rows = await history(targetId, 8);
  const icon = (r) => (r.role === "user" ? "👤" : r.from_name === "bot" ? "🤖" : "🙋");
  const status = c.muted ? "🔇 bot bu chatda jim" : c.handoff ? "🙋 sizga uzatilgan — bot jim" : "🤖 bot javob beradi";
  const lines = [`💬 ${c.name ?? targetId}`, `Holat: ${status}`, ""];
  for (const r of rows) lines.push(`${icon(r)} ${r.content.slice(0, 160)}`);
  const toggle = c.muted || c.handoff
    ? btn("▶️ Bot javob bersin", `cr:${targetId}`)
    : btn("🔇 Bot jim tursin", `cm:${targetId}`);
  return {
    text: lines.join("\n"),
    markup: ik([
      [btn("✍️ Javob yozish", `cw:${targetId}`), toggle],
      [btn("📄 Rasmlarini PDF qilish", `cp:${targetId}`)],
      [btn("⬅️ Chatlar", "m:chats")],
    ]),
  };
}

async function showProfile(chatId) {
  const profile = await getProfile();
  await say(chatId, `👤 Joriy profil (bot mijozlarga shunga tayanib javob beradi):\n\n${profile}`, {
    reply_markup: ik([
      [btn("✏️ Yangidan yozish", "p:new"), btn("➕ Qo'shish", "p:add")],
      [btn("♻️ Asl holiga qaytarish", "p:reset")],
    ]),
  });
}

const WH_PRESETS = ik([
  [btn("09:00–18:00 · Du–Ju", "wh:540-1080-12345")],
  [btn("09:00–18:00 · Du–Sh", "wh:540-1080-123456")],
  [btn("10:00–20:00 · har kuni", "wh:600-1200-1234567")],
  [btn("✏️ Boshqa vaqt", "wh:custom"), btn("🔕 O'chirish", "wh:off")],
]);

async function whText() {
  return `🕘 Ish vaqti: ${formatWorkHours(await getWorkHours())}\n\nIsh vaqtida bot jim turadi — siz o'zingiz javob berasiz. Qolgan vaqtda bot javob beradi.`;
}

async function settingsScreen() {
  const f = await getFlags();
  return {
    text: ["⚙️ Sozlamalar", "", ...(await statusLines())].join("\n"),
    markup: ik([
      [btn(`✍️ Avto-javob: ${f.auto_send ? "✅" : "❌"}`, "s:auto"), btn(`🧠 Xotira: ${f.memory ? "✅" : "❌"}`, "s:mem")],
      [btn(`🤫 Siz yozgach jimlik: ${f.quiet_minutes ? `${f.quiet_minutes} daq` : "yo'q"} 🔄`, "s:quiet")],
      [btn(f.paused ? "▶️ Botni yoqish" : "⏸ Botni to'xtatish", "s:pause")],
    ]),
  };
}

// ---------- Amallar ----------

async function setProfile(chatId, text, append = false) {
  if (!dbEnabled()) return say(chatId, NEED_DB);
  if (!text.trim()) return say(chatId, "Matn bo'sh.");
  const value = append ? `${(await getProfile()).trimEnd()}\n- ${text.trim()}` : text.trim();
  await kvSet("profile", { text: value });
  await say(chatId, append ? "✅ Profilga qo'shildi." : "✅ Profil yangilandi.");
}

async function setWorkHoursText(chatId, text) {
  if (!dbEnabled()) return say(chatId, NEED_DB);
  if (/^(off|o'chir|ochir|yo'q|0)$/i.test(text.trim())) {
    await kvDelete("work_hours");
    return say(chatId, "✅ Ish vaqti o'chirildi — bot har doim javob beradi.");
  }
  const wh = parseWorkHours(text);
  if (!wh) return say(chatId, "Format: 09:00-18:00 1-5  (kunlar: 1=Du … 7=Ya, masalan 1-5 yoki 1-5,7)");
  await kvSet("work_hours", wh);
  await say(chatId, `✅ Ish vaqti: ${formatWorkHours(wh)}`);
}

async function sendToClient(chatId, targetId, text) {
  if (!dbEnabled()) return say(chatId, NEED_DB);
  const bcid = await kvGet("bcid");
  if (!bcid) return say(chatId, "Business ulanish topilmadi — biror mijoz yozgandan keyin urinib ko'ring.");
  const c = await chatGet(targetId);
  const sent = await tg("sendMessage", { business_connection_id: bcid, chat_id: Number(targetId), text });
  await saveMessage({ chatId: Number(targetId), role: "assistant", content: text, tgMessageId: sent.message_id, fromName: "owner" });
  await chatSet(Number(targetId), { handoff: false, last_message_at: new Date().toISOString() });
  await say(chatId, `✅ ${c?.name ?? targetId} ga yuborildi.`);
}

/** Egasi chatidagi rasmlardan (yoki bitta xabardagi rasmdan) PDF. */
async function ownerPdf(chatId, currentMedia, fileName) {
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});
  const pdf = await buildChatPdf({ chatId, currentMedia, fileName: fileName || "rasmlar" });
  if (!pdf) return say(chatId, "📄 Avval rasmlarni shu yerga yuboring (siqilgan rasm yoki JPG/PNG fayl), keyin «PDF qil» deng.");
  await sendDocument({
    chatId, bytes: pdf.bytes, filename: pdf.filename,
    caption: `📄 ${pdf.pages} sahifa${pdf.skipped ? ` (${pdf.skipped} ta fayl qo'shilmadi)` : ""}`,
  });
  if (dbEnabled()) await saveMessage({ chatId, role: "assistant", content: "[PDF]", fromName: "owner_dm", flag: "pdf" });
}

async function testReply(chatId, text, media) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const out = await previewClientReply({ text, media });
  if (!out) return say(chatId, "🧪 (javob yo'q)");
  const extra = [
    out.action === "handoff" ? "🙋 suhbat sizga uzatiladi" : null,
    out.alert !== "none" ? `🔔 ogohlantirish: ${out.alert}` : null,
    out.task !== "none" ? `📄 vazifa: ${out.task}` : null,
  ].filter(Boolean);
  await say(chatId, `🧪 Bot mijozga shunday javob beradi:\n\n${out.reply}${extra.length ? `\n\n${extra.join("\n")}` : ""}\n\n📝 ${out.note}`);
}

// ---------- AI orqali buyruqlar ----------

async function ownerSystemPrompt() {
  const chats = dbEnabled() ? await recentChats(20).catch(() => []) : [];
  const chatList = chats.length
    ? chats.map((c) => `${c.chat_id} — ${c.name ?? "nomsiz"}${c.handoff ? " (sizni kutyapti)" : ""}${c.muted ? " (bot jim)" : ""}`).join("\n")
    : "(ro'yxat bo'sh)";
  const profile = (await getProfile()).slice(0, 3000);
  return `Siz Telegram bot egasining shaxsiy yordamchisisiz. Egasi sizga o'zbek (yoki rus) tilida buyruq beradi.
Buyruqni aniqlab, JSON qaytaring. reply — egasiga qisqa, samimiy javob.

Buyruqlar (command):
- set_profile: profilni butunlay almashtirish (text — yangi profil to'liq matni)
- append_profile: profilga ma'lumot qo'shish (text — qo'shiladigan qator)
- set_work_hours: ish vaqtini o'rnatish (text — "HH:MM-HH:MM kunlar", kunlar 1=Du … 7=Ya, masalan "09:00-18:00 1-5")
- work_hours_off: ish vaqtini o'chirish
- report: hisobot
- list_chats: chatlar ro'yxati
- send_to_chat: mijozga egasi nomidan xabar yuborish (chat_id — ro'yxatdan aniq ID, text — yuboriladigan tayyor xabar). Mijoz topilmasa yoki bir nechta bo'lsa, command none va aniqlashtiring.
- resume_chat / mute_chat: chatda botni yoqish / jim qilish (chat_id)
- images_to_pdf: egasi yuborgan rasmlardan PDF (file_name — mos nom)
- set_auto_send / set_memory: value — true yoqish, false o'chirish
- pause_bot / resume_bot: botni butunlay to'xtatish / yoqish
- test_reply: mijoz o'rnida sinash (text — mijoz xabari)
- set_quiet_minutes: egasi chatda o'zi yozgach, bot o'sha chatda necha daqiqa jim tursin (text — faqat raqam, 0 — jim turmasin)
- none: boshqa har qanday so'rov — savolga javob, matn yozish, tarjima, rasm/hujjatni tahlil qilish; natijani reply'ga yozing.

Ishlatilmagan maydonlarni bo'sh qoldiring (value — false).

Joriy holat:
- Ish vaqti: ${formatWorkHours(await getWorkHours())}
- Profil:
${profile}

Oxirgi mijoz chatlari (ID — ism):
${chatList}`;
}

async function runOwnerAgent(chatId, m, media) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const text = m.text ?? m.caption ?? messageText(m);
  const parts = [{ type: "text", text }];
  const part = media ? await mediaPart(media) : null;
  if (part) parts.push(part);

  const out = await parseOwnerCommand({ system: await ownerSystemPrompt(), messages: [{ role: "user", content: parts }] });
  if (!out) return say(chatId, "Tushunmadim 🙏 Tugmalardan foydalaning yoki boshqacha yozing.");

  const reply = () => (out.reply ? say(chatId, out.reply) : null);
  switch (out.command) {
    case "set_profile":
      return setProfile(chatId, out.text);
    case "append_profile":
      return setProfile(chatId, out.text, true);
    case "set_work_hours":
      return setWorkHoursText(chatId, out.text);
    case "work_hours_off":
      return setWorkHoursText(chatId, "off");
    case "report":
      return showReport(chatId);
    case "list_chats":
      return showChats(chatId);
    case "send_to_chat": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const c = out.chat_id ? await chatGet(out.chat_id).catch(() => null) : null;
      if (!c || !out.text.trim()) return say(chatId, out.reply || "Qaysi mijozga va nima yozay? Aniqroq ayting.");
      // Egasi nomidan yuborishdan oldin tasdiq.
      return say(chatId, `📤 ${c.name ?? c.chat_id} ga yuborilsinmi?\n\n${out.text.trim()}`, {
        reply_markup: ik([[btn("✅ Yuborish", `send:${c.chat_id}`), btn("✏️ O'zim yozaman", `cw:${c.chat_id}`)], [btn("❌ Bekor", "x")]]),
      });
    }
    case "resume_chat":
    case "mute_chat": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const c = out.chat_id ? await chatGet(out.chat_id).catch(() => null) : null;
      if (!c) return say(chatId, out.reply || "Qaysi chat? Aniqroq ayting.");
      await chatSet(c.chat_id, out.command === "mute_chat" ? { muted: true } : { muted: false, handoff: false });
      return say(chatId, `✅ ${c.name ?? c.chat_id}: ${out.command === "mute_chat" ? "bot endi jim" : "bot yana javob beradi"}.`);
    }
    case "images_to_pdf":
      return ownerPdf(chatId, media, out.file_name);
    case "set_auto_send":
    case "set_memory":
    case "pause_bot":
    case "resume_bot": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const map = {
        set_auto_send: ["auto_send", out.value],
        set_memory: ["memory", out.value],
        pause_bot: ["paused", true],
        resume_bot: ["paused", false],
      };
      await setFlag(...map[out.command]);
      const { text: t, markup } = await settingsScreen();
      return say(chatId, `✅ Bajarildi.\n\n${t}`, { reply_markup: markup });
    }
    case "test_reply":
      return testReply(chatId, out.text || text, media);
    case "set_quiet_minutes": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const n = Math.round(Number(out.text.match(/\d+/)?.[0]));
      if (!Number.isFinite(n) || n < 0 || n > 1440) return say(chatId, "Necha daqiqa? Masalan: «men yozgach 15 daqiqa jim tur».");
      await setFlag("quiet_minutes", n);
      return say(chatId, n ? `✅ Siz chatda yozgach, bot o'sha chatda ${n} daqiqa jim turadi.` : "✅ Bot endi siz yozgandan keyin ham javob beradi.");
    }
    default:
      return reply() ?? say(chatId, "🙂");
  }
}

// ---------- ForceReply javoblari ----------

async function handleAnswer(chatId, m, promptText) {
  const text = (m.text ?? m.caption ?? "").trim();
  if (promptText.startsWith(ASK.profileNew)) await setProfile(chatId, text);
  else if (promptText.startsWith(ASK.profileAdd)) await setProfile(chatId, text, true);
  else if (promptText.startsWith(ASK.wh)) await setWorkHoursText(chatId, text);
  else if (promptText.startsWith(ASK.test)) await testReply(chatId, text || messageText(m), mediaInfo(m));
  else if (promptText.startsWith(ASK.reply)) {
    const id = promptText.match(/#chat (-?\d+)/)?.[1];
    if (!id || !text) await say(chatId, "Xabar bo'sh — yuborilmadi.");
    else await sendToClient(chatId, id, text);
  } else return false;
  return true;
}

// ---------- Kirish nuqtalari ----------

export async function onOwnerMessage(m) {
  const chatId = m.chat.id;
  const fromId = String(m.from?.id ?? "");
  const isOwner = Boolean(ownerId()) && fromId === ownerId();

  if (!isOwner) {
    if (m.text?.startsWith("/start")) {
      await say(chatId, ownerId()
        ? `Bu shaxsiy yordamchi bot. Sizning Telegram ID: ${fromId}`
        : `Sizning Telegram ID: ${fromId}\nOWNER_ID hali o'rnatilmagan — shu ID ni Vercel'dagi OWNER_ID ga yozing.`);
    }
    return;
  }

  // ForceReply savoliga javob.
  const rt = m.reply_to_message;
  if (rt?.from?.is_bot && rt.text) {
    const handled = await handleAnswer(chatId, m, rt.text);
    if (handled) return;
  }

  const text = m.text?.trim() ?? "";
  const cmd = text.startsWith("/") ? text.split(/\s/)[0].split("@")[0].toLowerCase() : null;
  const arg = cmd ? text.slice(text.indexOf(cmd) + cmd.length).trim() : "";

  switch (cmd ?? text) {
    case "/start":
    case "/menu":
      return showWelcome(chatId);
    case "/help":
    case "/yordam":
    case KB.help:
      return say(chatId, HELP, { reply_markup: MAIN_KEYBOARD });
    case "/hisobot":
    case KB.report:
      return showReport(chatId);
    case "/chatlar":
    case KB.chats:
      return showChats(chatId);
    case "/profil":
    case KB.profile:
      return showProfile(chatId);
    case "/profil_yangi":
      return arg ? setProfile(chatId, arg) : ask(chatId, `${ASK.profileNew}:`, "Profil matni");
    case "/profil_qosh":
      return arg ? setProfile(chatId, arg, true) : ask(chatId, `${ASK.profileAdd}:`, "Masalan: yetkazib berish bepul");
    case "/ish_vaqti":
    case KB.wh:
      return arg ? setWorkHoursText(chatId, arg) : say(chatId, await whText(), { reply_markup: WH_PRESETS });
    case "/status":
    case "/sozlamalar":
    case KB.settings: {
      const { text: t, markup } = await settingsScreen();
      return say(chatId, t, { reply_markup: markup });
    }
    case "/sinov":
    case KB.test:
      return ask(chatId, `${ASK.test} — matn, rasm, ovozli xabar yoki fayl. Bot mijozga qanday javob berishini ko'rsataman:`, "Mijoz xabari");
    case "/pdf":
    case KB.pdf:
      return say(chatId, "📄 Rasmlarni shu yerga yuboring (bir nechtasini birdan ham bo'ladi), so'ng «📄 PDF qilish» tugmasini bosing yoki «PDF qil» deb yozing.");
  }
  if (cmd) return say(chatId, HELP, { reply_markup: MAIN_KEYBOARD });

  const media = mediaInfo(m);

  // Izohsiz media: saqlaymiz (PDF uchun) va nima qilishni so'raymiz.
  if (media && !m.caption) {
    let count = media.kind === "image" ? 1 : 0;
    if (dbEnabled()) {
      const myId = await saveMessage({ chatId, role: "user", content: messageText(m), tgMessageId: m.message_id, fromName: "owner_dm", media });
      await sleep(2500); // albom bo'lsa — oxirgisini kutamiz
      const last = await lastRow(chatId);
      if (!last || last.id !== myId) return;
      count = (await imagesSinceLastPdf(chatId)).length;
    }
    const rows = [];
    if (count) rows.push([btn(`📄 PDF qilish (${count} ta rasm)`, "pdf")]);
    rows.push([btn("🧪 Mijoz yuborgandek sinash", "t")]);
    return say(chatId, "📎 Qabul qildim. Nima qilay? (Yoki oddiy so'z bilan yozing.)", {
      reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
      reply_markup: ik(rows),
    });
  }

  if (dbEnabled() && media) {
    await saveMessage({ chatId, role: "user", content: messageText(m), tgMessageId: m.message_id, fromName: "owner_dm", media });
  }
  return runOwnerAgent(chatId, m, media);
}

export async function onCallback(cq) {
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  if (!ownerId() || String(cq.from.id) !== ownerId()) return answer("Faqat bot egasi uchun");

  const msg = cq.message;
  const chatId = msg?.chat.id;
  const data = cq.data ?? "";
  const i = data.indexOf(":");
  const [k, arg] = i === -1 ? [data, ""] : [data.slice(0, i), data.slice(i + 1)];
  if (!chatId) return answer();
  await answer();

  switch (k) {
    case "m":
      if (arg === "report") return showReport(chatId);
      if (arg === "chats") return showChats(chatId, msg);
      return;

    case "p":
      if (arg === "new") return ask(chatId, `${ASK.profileNew}:`, "Profil matni");
      if (arg === "add") return ask(chatId, `${ASK.profileAdd}:`, "Masalan: yetkazib berish bepul");
      if (arg === "reset") {
        if (!dbEnabled()) return say(chatId, NEED_DB);
        await kvDelete("profile");
        return say(chatId, "♻️ Profil asl holiga (profile.md) qaytarildi.");
      }
      return;

    case "wh": {
      if (arg === "custom") return ask(chatId, `${ASK.wh} (masalan: 09:00-18:00 1-5, kunlar 1=Du … 7=Ya):`, "09:00-18:00 1-5");
      if (!dbEnabled()) return say(chatId, NEED_DB);
      if (arg === "off") await kvDelete("work_hours");
      else {
        const [start, end, days] = arg.split("-");
        await kvSet("work_hours", { start: Number(start), end: Number(end), days: [...days].map(Number) });
      }
      return edit(msg, await whText(), WH_PRESETS);
    }

    case "s": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const f = await getFlags();
      if (arg === "auto") await setFlag("auto_send", !f.auto_send);
      if (arg === "mem") await setFlag("memory", !f.memory);
      if (arg === "pause") await setFlag("paused", !f.paused);
      if (arg === "quiet") {
        const i = QUIET_STEPS.indexOf(f.quiet_minutes);
        await setFlag("quiet_minutes", QUIET_STEPS[(i + 1) % QUIET_STEPS.length]);
      }
      const { text, markup } = await settingsScreen();
      return edit(msg, text, markup);
    }

    case "c": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const { text, markup } = await chatCard(arg);
      return edit(msg, text, markup);
    }
    case "cr":
    case "cm": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      await chatSet(Number(arg), k === "cm" ? { muted: true } : { muted: false, handoff: false });
      const { text, markup } = await chatCard(arg);
      return edit(msg, text, markup);
    }
    case "cw": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      const c = await chatGet(arg);
      return ask(chatId, `${ASK.reply} — ${c?.name ?? "mijoz"} (#chat ${arg}):`, "Xabar sizning nomingizdan ketadi");
    }
    case "cp": {
      if (!dbEnabled()) return say(chatId, NEED_DB);
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});
      const c = await chatGet(arg);
      const pdf = await buildChatPdf({ chatId: Number(arg), fileName: c?.name ?? "rasmlar" });
      if (!pdf) return say(chatId, "Bu chatda PDF uchun yangi rasm yo'q.");
      return sendDocument({ chatId, bytes: pdf.bytes, filename: pdf.filename, caption: `📄 ${c?.name ?? ""} — ${pdf.pages} sahifa` });
    }

    case "send": {
      const body = msg.text?.split("\n\n").slice(1).join("\n\n").trim();
      if (!body) return say(chatId, "Xabar matni topilmadi.");
      await edit(msg, `${msg.text}\n\n⏳ Yuborilmoqda…`);
      await sendToClient(chatId, arg, body);
      return edit(msg, `${msg.text}\n\n✅ Yuborildi`);
    }
    case "x":
      return edit(msg, `${msg.text ?? ""}\n\n❌ Bekor qilindi`);

    case "pdf": {
      const src = msg.reply_to_message ? mediaInfo(msg.reply_to_message) : null;
      return ownerPdf(chatId, src, "rasmlar");
    }
    case "t": {
      const src = msg.reply_to_message;
      if (!src) return ask(chatId, `${ASK.test}:`, "Mijoz xabari");
      return testReply(chatId, src.caption ?? messageText(src), mediaInfo(src));
    }
  }
}
