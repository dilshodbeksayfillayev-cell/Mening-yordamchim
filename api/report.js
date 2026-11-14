import { notifyOwner } from "../lib/telegram.js";
import { dbEnabled, kvGet, kvSet } from "../lib/db.js";
import { buildReport } from "../lib/report.js";

// Vercel Cron har kuni chaqiradi (vercel.json). CRON_SECRET o'rnatilsa, faqat Vercel chaqira oladi;
// o'rnatilmasa ham soatiga ko'pi bilan bir marta yuboradi.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!dbEnabled()) return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY yo'q" });

  if (!secret) {
    const last = await kvGet("last_report");
    if (last && Date.now() - Date.parse(last) < 3600e3) return Response.json({ ok: true, skipped: true });
  }
  await kvSet("last_report", new Date().toISOString());
  await notifyOwner(await buildReport());
  return Response.json({ ok: true });
}
