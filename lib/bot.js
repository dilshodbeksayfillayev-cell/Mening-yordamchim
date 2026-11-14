// Kiruvchi update'larni taqsimlash va business chatlarda (egasining shaxsiy chatlari) mijozlarga javob.
import {
  tg, ownerId, sleep, notifyOwner, fullName, messageText, dangerKind, mediaInfo, sendDocument,
} from "./telegram.js";
import {
  dbEnabled, saveMessage, lastRow, history, pendingUserRows, chatGet, chatSet, kvGet, kvSet,
} from "./db.js";
import { generateReply } from "./ai.js";
import { getFlags, getWorkHours, isWithin } from "./settings.js";
import { clientSystemPrompt, buildMessages, buildChatPdf, DANGER_REPLY, ALERT_LABELS } from "./client.js";
import { onOwnerMessage, onCallback } from "./owner.js";

const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 5000);
const HANDOFF_HOURS = Number(process.env.HANDOFF_HOURS || 12);

/** "Yozmoqda..." ko'rsatib, matn uzunligiga qarab biroz kutadi. */
async function typeLike(bcid, chatId, text, action = "typing") {
  const end = Date.now() + Math.min(9000, Math.max(2000, 1200 + text.length * 35));
  while (Date.now() < end) {
    await tg("sendChatAction", { business_connection_id: bcid, chat_id: chatId, action }).catch(() => {});
    await sleep(Math.min(4500, end - Date.now()));
  }
}

async function sendHumanLike(bcid, chatId, text) {
  await typeLike(bcid, chatId, text);
  return tg("sendMessage", { business_connection_id: bcid, chat_id: chatId, text });
}

function isSilencedChat(c) {
  if (!c) return false;
  if (c.muted) return true;
  if (!c.handoff) return false;
  const since = Date.parse(c.handoff_at ?? 0);
  return Date.now() - since < HANDOFF_HOURS * 3600e3;
}

let knownBcid = null;
async function rememberBcid(bcid) {
  if (!dbEnabled() || knownBcid === bcid) return;
  if ((await kvGet("bcid").catch(() => null)) !== bcid) await kvSet("bcid", bcid).catch(() => {});
  knownBcid = bcid;
}

async function onBusinessMessage(m) {
  if (m.sender_business_bot) return; // botning o'zi yuborgan xabar

  const conn = await tg("getBusinessConnection", { business_connection_id: m.business_connection_id });
  if (!ownerId() || String(conn.user.id) !== ownerId()) return; // begona akkaunt ulangan
  if (conn.is_enabled === false) return;

  const bcid = m.business_connection_id;
  const chatId = m.chat.id;
  const text = messageText(m);
  const db = dbEnabled();
  const now = new Date().toISOString();
  await rememberBcid(bcid);

  // Egasining o'zi yozdi: tarixga yozamiz va bu chatda botni yana yoqamiz (uzatish tugaydi).
  if (m.from?.id === conn.user.id) {
    if (db) {
      await saveMessage({ chatId, role: "assistant", content: text, tgMessageId: m.message_id, fromName: "owner" });
      await chatSet(chatId, { handoff: false, last_message_at: now });
    }
    return;
  }

  const name = fullName(m.from);
  const danger = dangerKind(m);
  const media = danger ? null : mediaInfo(m);
  let myId = null;
  let chat = null;
  if (db) {
    chat = await chatGet(chatId).catch(() => null);
    myId = await saveMessage({
      chatId, role: "user", content: text, tgMessageId: m.message_id, fromName: name,
      flag: danger ? `xavfli:${danger}` : null, media,
    });
    await chatSet(chatId, { name, last_message_at: now });
  }

  const flags = await getFlags();
  if (flags.paused) return; // egasi botni to'xtatgan
  if (isWithin(await getWorkHours())) return; // ish vaqtida egasi o'zi javob beradi
  if (isSilencedChat(chat)) return; // bu chat egasiga uzatilgan yoki jim qilingan

  if (danger) {
    const label = danger === "havola" ? "havola" : "xavfli fayl";
    if (!flags.auto_send) {
      await notifyOwner(`⚠️ ${name} ${label} yubordi:\n\n${text.slice(0, 500)}`);
      return;
    }
    const sent = await sendHumanLike(bcid, chatId, DANGER_REPLY[danger]);
    if (db) {
      await saveMessage({ chatId, role: "assistant", content: DANGER_REPLY[danger], tgMessageId: sent.message_id, fromName: "bot", flag: "handoff" });
      await chatSet(chatId, { handoff: true, handoff_at: now });
    }
    await notifyOwner(`⚠️ ${name} ${label} yubordi — bot ochmadi, siz o'zingiz ko'ring.\n\n«${text.slice(0, 500)}»`, {
      reply_markup: db ? { inline_keyboard: [[{ text: "💬 Chatni ochish", callback_data: `c:${chatId}` }]] } : undefined,
    });
    return;
  }

  // Mijoz fikrini (yoki rasmlar albomini) bo'lib yuborsa — oxirgisini kutib, bitta javob beramiz.
  let rows;
  if (db) {
    await sleep(DEBOUNCE_MS);
    const last = await lastRow(chatId);
    if (!last || last.id !== myId) return; // yangiroq xabar bor yoki egasi javob berdi
    rows = flags.memory ? await history(chatId, 50) : await pendingUserRows(chatId);
  } else {
    rows = [{ role: "user", content: text, media }];
  }

  const messages = await buildMessages(rows);
  if (!messages.length) return;
  const out = await generateReply({ system: await clientSystemPrompt(), messages });
  if (!out) return;

  if (!flags.auto_send) {
    await notifyOwner(`✍️ ${name} uchun javob loyihasi (avto-javob o'chiq):\n\n${out.reply}\n\n📝 ${out.note}`);
    return;
  }

  const canReply = conn.rights ? conn.rights.can_reply : conn.can_reply;
  if (canReply === false) {
    await notifyOwner("⚠️ Botda javob yozish huquqi yo'q. Telegram Business → Chatbots bo'limida ruxsat bering.");
    return;
  }

  // Vazifa: rasmlardan PDF.
  let sent;
  const tags = [];
  if (out.task === "images_to_pdf") {
    const pdf = await buildChatPdf({ chatId, currentMedia: media, fileName: out.file_name || "rasmlar" });
    if (pdf) {
      await typeLike(bcid, chatId, out.reply, "upload_document");
      sent = await sendDocument({ chatId, bcid, bytes: pdf.bytes, filename: pdf.filename, caption: out.reply });
      tags.push("pdf");
    } else {
      out.reply = "PDF qilish uchun rasmlarni shu chatga yuboring, keyin yana yozing 🙂";
    }
  }
  if (!sent) sent = await sendHumanLike(bcid, chatId, out.reply);

  if (out.alert !== "none") tags.push(out.alert);
  if (out.action === "handoff") tags.push("handoff");
  if (db) {
    await saveMessage({
      chatId, role: "assistant", content: out.reply, tgMessageId: sent.message_id, fromName: "bot",
      flag: tags.join(",") || null,
    });
    if (out.action === "handoff") await chatSet(chatId, { handoff: true, handoff_at: new Date().toISOString() });
  }

  if (out.alert !== "none" || out.action === "handoff") {
    const title = out.action === "handoff"
      ? `🙋 ${name} bilan suhbat sizga uzatildi${db ? " — bot siz yozguningizcha jim turadi" : ""}`
      : `${ALERT_LABELS[out.alert]}: ${name}`;
    const extra = out.alert !== "none" && out.action === "handoff" ? `\n${ALERT_LABELS[out.alert]}` : "";
    const buttons = db
      ? { inline_keyboard: [[
          { text: "💬 Chatni ochish", callback_data: `c:${chatId}` },
          { text: "✍️ Javob yozish", callback_data: `cw:${chatId}` },
        ]] }
      : undefined;
    await notifyOwner(
      `${title}${extra}\n\n📝 ${out.note}\n💬 Mijoz: «${text.slice(0, 300)}»\n🤖 Bot: «${out.reply.slice(0, 300)}»`,
      { reply_markup: buttons },
    );
  }
}

async function onBusinessConnection(c) {
  if (!ownerId() || String(c.user.id) !== ownerId()) return;
  if (c.is_enabled) await rememberBcid(c.id);
  await notifyOwner(
    c.is_enabled
      ? "✅ Bot akkauntingizga ulandi. Chatlarda javob yozishni boshlaydi."
      : "⏸ Bot akkauntingizdan uzildi.",
  );
}

export async function handleUpdate(update) {
  if (update.business_message) return onBusinessMessage(update.business_message);
  if (update.business_connection) return onBusinessConnection(update.business_connection);
  if (update.callback_query) return onCallback(update.callback_query);
  if (update.message?.chat?.type === "private") return onOwnerMessage(update.message);
}
