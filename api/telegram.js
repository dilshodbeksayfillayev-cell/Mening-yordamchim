import { waitUntil } from "@vercel/functions";
import { handleUpdate } from "../lib/bot.js";
import { webhookSecret } from "../lib/telegram.js";

// Telegram webhook. Darhol 200 qaytaramiz (aks holda Telegram qayta yuboradi),
// ishni esa javob qaytgandan keyin waitUntil ichida davom ettiramiz.
export async function POST(request) {
  if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json();
  waitUntil(
    handleUpdate(update).catch((err) => console.error("update", update.update_id, err)),
  );
  return new Response("ok");
}

export function GET() {
  return new Response("Telegram webhook ishlayapti. Sozlash: /api/setup");
}
