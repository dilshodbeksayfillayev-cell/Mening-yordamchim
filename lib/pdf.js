// Rasmlardan PDF yasash (har rasm — alohida A4 sahifa, yo'nalishi rasmga qarab).
import { PDFDocument } from "pdf-lib";
import { downloadFile } from "./telegram.js";

const A4 = [595.28, 841.89];
const MARGIN = 18;
const MAX_BYTES = 20 * 1024 * 1024;

const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8;

/** Media ro'yxatidan (mediaInfo obyektlari) PDF. Natija: { bytes, pages, skipped } yoki null. */
export async function imagesToPdf(mediaList) {
  const doc = await PDFDocument.create();
  let pages = 0;
  let skipped = 0;

  for (const info of mediaList.slice(0, 30)) {
    if (!info || info.kind !== "image" || info.size > MAX_BYTES) {
      skipped++;
      continue;
    }
    try {
      const buf = await downloadFile(info.file_id);
      let img;
      if (isPng(buf)) img = await doc.embedPng(buf);
      else if (isJpeg(buf)) img = await doc.embedJpg(buf);
      else {
        skipped++; // webp va boshqalar
        continue;
      }
      const [pw, ph] = img.width > img.height ? [A4[1], A4[0]] : A4;
      const scale = Math.min((pw - 2 * MARGIN) / img.width, (ph - 2 * MARGIN) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      pages++;
    } catch (err) {
      console.error("pdf image", err);
      skipped++;
    }
  }

  if (!pages) return null;
  return { bytes: await doc.save(), pages, skipped };
}

export function pdfFileName(name) {
  const base = String(name || "hujjat").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60) || "hujjat";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}
