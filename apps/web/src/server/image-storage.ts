/**
 * Image storage abstraction. Сейчас — local filesystem
 * (`apps/web/public/uploads/products/<shard>/<hash>/`); future — S3 / Vercel Blob
 * через тот же interface (см. docs/admin/image-upload.md, Phase 6).
 *
 * Структура папок: `/uploads/products/<2-char hash prefix>/<hash>/`:
 *   - `original.<ext>` — raw upload (archival).
 *   - `w400.webp`, `w800.webp`, ... — processed variants для srcset.
 *   - `manifest.json` — `{ original: "...", sizes: { w400: "...", w800: "..." } }`,
 *     используется ProductImage для построения srcset (Phase 5).
 *
 * Возвращаемые URL'ы — public-relative (`/uploads/products/...`), Next serve'ит
 * `public/` как static assets автоматически.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { ProcessImageResult, TargetWidth } from "./image-pipeline";

/** Корень storage'а. Env var UPLOAD_STORAGE_ROOT позволяет явно задать
 *  абсолютный путь в продакшн-контейнере вместо runtime process.cwd(). */
const STORAGE_ROOT =
  process.env["UPLOAD_STORAGE_ROOT"] ?? path.join(process.cwd(), "public", "uploads", "products");
/** Public URL prefix — то что увидит браузер. */
const PUBLIC_PREFIX = "/uploads/products";

interface SaveResult {
  /** Главный URL — оригинал. Используется как `ProductImage.url` в БД. */
  url: string;
  /** WebP URL'ы processed-вариантов, ключ = `w400`/`w800`/etc. */
  sizes: Record<string, string>;
  /** AVIF URL'ы (тот же набор breakpoints, format = avif). */
  avifSizes: Record<string, string>;
}

/**
 * Кладёт processed-результат на FS. Имена detrministic — повторный upload
 * того же файла переиспользует существующую папку (no-op write).
 *
 * Шардинг по первым 2 символам hash'а — типичный паттерн чтобы избежать
 * single dir с 10k+ files (плохо для inode-cache).
 */
export async function saveProcessed(result: ProcessImageResult): Promise<SaveResult> {
  const shard = result.hash.slice(0, 2);
  const dir = path.join(STORAGE_ROOT, shard, result.hash);
  await fs.mkdir(dir, { recursive: true });

  // Original — archival copy.
  const originalName = `original.${result.originalExt}`;
  await fs.writeFile(path.join(dir, originalName), result.original);

  const sizes: Record<string, string> = {};
  for (const [width, buf] of result.webpSizes.entries()) {
    const fileName = webpFileName(width);
    await fs.writeFile(path.join(dir, fileName), buf);
    sizes[`w${width}`] = `${PUBLIC_PREFIX}/${shard}/${result.hash}/${fileName}`;
  }
  const avifSizes: Record<string, string> = {};
  for (const [width, buf] of result.avifSizes.entries()) {
    const fileName = avifFileName(width);
    await fs.writeFile(path.join(dir, fileName), buf);
    avifSizes[`w${width}`] = `${PUBLIC_PREFIX}/${shard}/${result.hash}/${fileName}`;
  }

  // Manifest для srcset-генерации (Phase 5 + 5b).
  const manifest = {
    hash: result.hash,
    original: `${PUBLIC_PREFIX}/${shard}/${result.hash}/${originalName}`,
    width: result.meta.width,
    height: result.meta.height,
    format: result.meta.format,
    sizes,
    avifSizes,
  };
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    // Используем самую большую processed-версию (или original для GIF/no-webp)
    // как primary URL. Browsers с manifestSizes пойдут через `<img srcset>`.
    url: pickPrimaryUrl(manifest, result),
    sizes,
    avifSizes,
  };
}

function webpFileName(width: TargetWidth): string {
  return `w${width}.webp`;
}

function avifFileName(width: TargetWidth): string {
  return `w${width}.avif`;
}

function pickPrimaryUrl(
  manifest: { original: string; sizes: Record<string, string> },
  result: ProcessImageResult,
): string {
  // Для GIF / no-processed (webpSizes пустой) — отдаём original.
  if (result.webpSizes.size === 0) return manifest.original;
  // Иначе берём самый большой webp вариант — он визуально идентичен original'у,
  // но в разы меньше (WebP q88 ≈ 30% от JPEG q92).
  const widths = Array.from(result.webpSizes.keys()).sort((a, b) => b - a);
  const maxWidth = widths[0];
  if (maxWidth === undefined) return manifest.original;
  return manifest.sizes[`w${maxWidth}`] ?? manifest.original;
}

/**
 * Удаление по URL — best-effort. На FS-backend сносит всю папку картинки
 * (включая siblings разных size'ов и manifest).
 *
 * NB: НЕ вызывается автоматически на ProductImage.delete — сначала нужен
 * orphan-сборщик (Phase 5) который убедится что URL не reference'ится с другого
 * товара/варианта. Сейчас файлы остаются — disk cost минимальный для baby-shop'а.
 */
export async function deleteByUrl(url: string): Promise<void> {
  // URL вида /uploads/products/<shard>/<hash>/<file>.
  if (!url.startsWith(PUBLIC_PREFIX)) return;
  const parts = url.slice(PUBLIC_PREFIX.length + 1).split("/");
  const shard = parts[0];
  const hash = parts[1];
  if (!shard || !hash) return;
  const dir = path.join(STORAGE_ROOT, shard, hash);
  await fs.rm(dir, { recursive: true, force: true });
}
