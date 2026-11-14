import { tg, webhookSecret, notifyOwner } from "../lib/telegram.js";
import { dbEnabled, kvGet, kvSet } from "../lib/db.js";
import { currentModel } from "../lib/ai.js";
import { getFlags, getAiKey } from "../lib/settings.js";
import { MAIN_KEYBOARD } from "../lib/owner.js";

const RELEASE_NOTES = `🆕 Bot yangilandi!

Yangi imkoniyatlar:
🔑 AI (OpenRouter) kalitini endi shu botning o'zida almashtirasiz: ⚙️ Sozlamalar → 🔑 AI kalitini almashtirish. Vercel'ga kirish shart emas; kalitli xabaringiz chatdan avtomatik o'chiriladi
🚨 Bot mijozga javob bera olmasa (kalit noto'g'ri, pul tugagan) — darhol sizga xabar beradi
⚡ Bot endi tezroq javob beradi: AI javob tayyorlayotganda mijoz «yozmoqda...» ni ko'radi
⏱ Javobdan oldin kutish vaqtini o'zingiz yozasiz (soniyada): ⚙️ Sozlamalar → ⏱ Kutish
🤫 Siz chatda o'zingiz yozsangiz, bot o'sha chatga aralashmaydi — necha soniya ekanini ⚙️ Sozlamalar → 🤫 Jimlik'da yozasiz
🎛 Pastda qulay tugmalar paydo bo'ldi — hisobot, chatlar, profil, ish vaqti, sozlamalar, sinov, PDF
🗣 Endi menga oddiy so'z bilan buyruq bera olasiz: «ish vaqtimni 9 dan 18 gacha qil», «profilimga qo'sh: …», «Alisherga yoz: …», «botni to'xtat»
📄 Mijoz rasmlarini yuborib «PDF qilib ber» desa — bot rasmlarni bitta PDF qilib beradi. Siz ham shu yerga rasm tashlab PDF qildira olasiz
💬 Chatlar bo'limida: oxirgi xabarlarni ko'rish, mijozga o'z nomingizdan javob yozish, botni chatda yoqish/jim qilish
🚨 Suhbat jiddiylashsa (janjal, tahdid, huquqiy masala, katta pul) — bot suhbatni sizga uzatadi va darhol xabar beradi
🧪 Sinov — mijoz o'rnida yozib, bot qanday javob berishini ko'rasiz

Batafsil: ❓ Yordam`;

const COMMANDS = [
  { command: "menu", description: "Asosiy menyu" },
  { command: "hisobot", description: "Oxirgi 24 soat hisoboti" },
  { command: "chatlar", description: "Mijozlar chatlari" },
  { command: "profil", description: "Profilni ko'rish va tahrirlash" },
  { command: "ish_vaqti", description: "Ish vaqtini sozlash" },
  { command: "sozlamalar", description: "Avto-javob, xotira, pauza" },
  { command: "sinov", description: "Bot javobini sinash" },
  { command: "pdf", description: "Rasmlardan PDF" },
  { command: "yordam", description: "Qanday foydalaniladi" },
];

// Webhook'ni production manziliga o'rnatadi, buyruqlar menyusini yangilaydi va holatni ko'rsatadi.
// Har bir yangi deploy haqida egasiga bir marta xabar beradi. Tokenni ko'rsatmaydi.
export async function GET(request) {
  const env = {
    TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    OWNER_ID: Boolean(process.env.OWNER_ID),
  };
  if (!env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, env }, { status: 500 });

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || new URL(request.url).host;
  const url = `https://${host}/api/telegram`;

  try {
    await tg("setWebhook", {
      url,
      secret_token: webhookSecret(),
      allowed_updates: ["message", "callback_query", "business_connection", "business_message"],
      drop_pending_updates: true,
    });
    await tg("setMyCommands", { commands: COMMANDS });
    const me = await tg("getMe");
    const info = await tg("getWebhookInfo");

    // Yangi deploy haqida egasiga bir marta xabar (tugmalar bilan).
    let announced = false;
    const deployId = process.env.VERCEL_DEPLOYMENT_ID || "local";
    const lastAnnounced = dbEnabled() ? await kvGet("announced_deployment").catch(() => null) : null;
    if (lastAnnounced !== deployId) {
      await notifyOwner(RELEASE_NOTES, { reply_markup: MAIN_KEYBOARD });
      if (dbEnabled()) await kvSet("announced_deployment", deployId).catch(() => {});
      announced = true;
    }

    return Response.json({
      ok: true,
      bot: `@${me.username}`,
      business_mode: me.can_connect_to_business ?? null,
      model: currentModel(),
      webhook: { url: info.url, pending: info.pending_update_count, last_error: info.last_error_message ?? null },
      database: dbEnabled() ? "ulangan" : "ulanmagan (ixtiyoriy)",
      flags: await getFlags(),
      ai_key: (await getAiKey())?.source ?? "yo'q",
      owner_notified: announced,
      env,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message), env }, { status: 500 });
  }
}
