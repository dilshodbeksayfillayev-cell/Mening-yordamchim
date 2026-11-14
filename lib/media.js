// Telegram faylini OpenRouter (OpenAI-mos) content part'iga aylantiradi.
import { downloadFile } from "./telegram.js";

const MAX_BYTES = 20 * 1024 * 1024; // Telegram bot limiti
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_MIMES = { "video/mp4": "video/mp4", "video/mpeg": "video/mpeg", "video/quicktime": "video/mov", "video/mov": "video/mov", "video/webm": "video/webm" };
const AUDIO_FORMATS = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/x-flac": "flac",
};

/** Content part yoki null (yuklab bo'lmasa yoki tur qo'llab-quvvatlanmasa). */
export async function mediaPart(info) {
  if (!info || info.kind === "other") return null;
  if (info.size > MAX_BYTES) return { type: "text", text: "(fayl 20 MB dan katta — ko'rib bo'lmadi)" };

  try {
    const buf = await downloadFile(info.file_id);
    const b64 = buf.toString("base64");

    switch (info.kind) {
      case "image": {
        const mime = IMAGE_MIMES.has(info.mime) ? info.mime : "image/jpeg";
        return { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } };
      }
      case "audio":
        return { type: "input_audio", input_audio: { data: b64, format: AUDIO_FORMATS[info.mime] ?? "ogg" } };
      case "video": {
        const mime = VIDEO_MIMES[info.mime] ?? "video/mp4";
        return { type: "video_url", video_url: { url: `data:${mime};base64,${b64}` } };
      }
      case "pdf":
        return {
          type: "file",
          file: { filename: info.name ?? "document.pdf", file_data: `data:application/pdf;base64,${b64}` },
        };
      case "text":
        if (buf.length > 200 * 1024) return null;
        return { type: "text", text: `Fayl "${info.name ?? "matn"}" mazmuni:\n${buf.toString("utf8").slice(0, 20000)}` };
      default:
        return null;
    }
  } catch (err) {
    console.error("media", info.kind, err);
    return null;
  }
}
