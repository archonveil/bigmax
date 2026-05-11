/**
 * Image-pipeline — `processImage(buffer)` берёт raw upload, прогоняет через
 * sharp (strip metadata + optional resize + WebP encode), возвращает набор
 * processed-вариантов разного размера.
 *
 * **Quality settings (lossless-visual):**
 *  - JPEG → WebP `quality: 88, smartSubsample: true` (~70% размера, визуально
 *    неотличимо от JPEG q92).
 *  - PNG с alpha → WebP `lossless: true` (50-60% PNG, alpha preserved).
 *  - GIF → store as-is (не процессим, animated GIF support — отдельная задача).
 *
 * **Limits** (защита от DoS и memory):
 *  - max input size: 10 MB (см. `MAX_BYTES`).
 *  - max dimensions: 6000×6000 px (см. `MAX_DIM`).
 *  - allowed formats: jpeg/png/webp/gif (см. `ALLOWED_FORMATS`).
 *
 * **Возврат:** content-addressable `hash` (sha256:0-16) → используется как
 * directory name для де-duplication (одна и та же картинка → один файл).
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DIM = 6000;
/** Размеры WebP-вариантов в порядке возрастания (для srcset). */
export const TARGET_WIDTHS = [400, 800, 1280, 1920] as const;
export type TargetWidth = (typeof TARGET_WIDTHS)[number];

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

export type ProcessImageError =
  | "file_too_large"
  | "unsupported_format"
  | "image_too_wide"
  | "image_too_tall"
  | "decode_failed"
  | "processing_failed";

export interface ProcessImageResult {
  /** Content-addressable hash (sha256 первые 16 hex-символов). */
  hash: string;
  /** Расширение оригинала, без точки: `jpg`/`png`/`webp`/`gif`. */
  originalExt: string;
  /** Оригинальный buffer (для archival storage). */
  original: Buffer;
  /** WebP-варианты для srcset, ключ = target-width. Если original меньше
   *  целевого width, кладём ровно одну версию равную original-ширине. */
  webpSizes: Map<TargetWidth, Buffer>;
  /** AVIF-варианты — параллельный набор тех же breakpoints. ~20-25% меньше
   *  WebP; `<picture><source type="image/avif">` подхватывает их в браузерах
   *  с AVIF support'ом (~88%). */
  avifSizes: Map<TargetWidth, Buffer>;
  /** Метаданные оригинала. */
  meta: {
    width: number;
    height: number;
    format: string;
    bytes: number;
  };
}

export type ProcessImageOutcome =
  | { ok: true; result: ProcessImageResult }
  | { ok: false; reason: ProcessImageError };

/**
 * Хеш для content-addressable имени файла. sha256 → hex → первые 16 символов
 * (64 бита энтропии — collision risk negligible до миллионов файлов).
 */
function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export async function processImage(buffer: Buffer): Promise<ProcessImageOutcome> {
  if (buffer.byteLength > MAX_BYTES) {
    return { ok: false, reason: "file_too_large" };
  }

  let pipeline: sharp.Sharp;
  let meta: sharp.Metadata;
  try {
    // `failOn: "none"` чтобы corrupt-но-восстановимый файл не упал на decode.
    // Sharp всё равно throw'нёт на полностью невалидном content.
    pipeline = sharp(buffer, { failOn: "none" });
    meta = await pipeline.metadata();
  } catch {
    return { ok: false, reason: "decode_failed" };
  }

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    return { ok: false, reason: "unsupported_format" };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    return { ok: false, reason: "decode_failed" };
  }
  if (width > MAX_DIM) return { ok: false, reason: "image_too_wide" };
  if (height > MAX_DIM) return { ok: false, reason: "image_too_tall" };

  const hash = contentHash(buffer);
  const originalExt = meta.format === "jpeg" ? "jpg" : meta.format;
  const hasAlpha = Boolean(meta.hasAlpha);

  // GIF — не процессим (анимация). Возвращаем только оригинал.
  if (meta.format === "gif") {
    return {
      ok: true,
      result: {
        hash,
        originalExt,
        original: buffer,
        webpSizes: new Map(),
        avifSizes: new Map(),
        meta: { width, height, format: meta.format, bytes: buffer.byteLength },
      },
    };
  }

  const webpSizes = new Map<TargetWidth, Buffer>();
  const avifSizes = new Map<TargetWidth, Buffer>();
  try {
    for (const targetWidth of TARGET_WIDTHS) {
      // Не upscale'им: если оригинал меньше target, оставляем original-width
      // (sharp resize с `withoutEnlargement` сам сделает это).
      const baseResize = (): sharp.Sharp =>
        sharp(buffer)
          .rotate() // honor EXIF orientation BEFORE strip
          .resize({ width: targetWidth, withoutEnlargement: true });

      // WebP + AVIF encoder'ы запускаем параллельно — sharp создаёт отдельный
      // pipeline на каждый `.toBuffer()`, не share'ит state. AVIF медленнее
      // ~2-3× WebP, но мы всё равно ждём оба перед записью на FS.
      // AVIF quality 60 ≈ визуально WebP q88 + меньше байт.
      const [webpBuf, avifBuf] = await Promise.all([
        baseResize()
          .webp(
            hasAlpha
              ? { lossless: true, effort: 4 }
              : { quality: 88, smartSubsample: true, effort: 4 },
          )
          .toBuffer(),
        baseResize()
          .avif(hasAlpha ? { lossless: true, effort: 4 } : { quality: 60, effort: 4 })
          .toBuffer(),
      ]);
      webpSizes.set(targetWidth, webpBuf);
      avifSizes.set(targetWidth, avifBuf);
      // Если оригинал уже меньше следующих target'ов — все они будут идентичны.
      // Break чтобы не дублировать одно и то же.
      if (width <= targetWidth) break;
    }
  } catch {
    return { ok: false, reason: "processing_failed" };
  }

  return {
    ok: true,
    result: {
      hash,
      originalExt,
      original: buffer,
      webpSizes,
      avifSizes,
      meta: { width, height, format: meta.format, bytes: buffer.byteLength },
    },
  };
}
