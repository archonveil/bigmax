/**
 * Orphan image cleanup (Phase 7) — удаляет filesystem-папки картинок,
 * которые НЕ reference'ятся ни одной строкой `ProductImage` в БД.
 *
 * **Зачем:** replace-set semantics в variant POST/PATCH делает delete-then-
 * create, при этом старые URL'ы остаются как файлы на диске. Со временем
 * `public/uploads/products/` накапливает мусор, который никогда никто не
 * увидит. Periodic cleanup освобождает место.
 *
 * **Безопасность:**
 *  - **24h age guard** — не удаляем папки моложе суток. Защищает от race
 *    condition'а: admin загрузил файл (`saveProcessed`), но БД-row ещё не
 *    создан (в-полёте PATCH-запрос); orphan-сборщик не должен снести этот
 *    «temporary orphan».
 *  - **Dry-run mode** — возвращает список без удаления, для preview'я.
 *  - **Content-addressable hash**: один и тот же файл может reference'иться
 *    с нескольких продуктов (de-dup на upload'е). Если HASH в Set referenced
 *    → не удаляем (даже если конкретный URL не совпал).
 *
 * **Алгоритм:**
 *   1. Walk `STORAGE_ROOT/<2-char shard>/<hash>/` — собираем все existing-папки.
 *   2. `prisma.productImage.findMany({ select: { url, sizes, avifSizes } })` —
 *      extract'им hash из каждого URL'а / size-URL'а (single source = `<hash>/`).
 *   3. Set difference: papкі на FS, отсутствующие в DB-referenced set.
 *   4. Фильтруем по `mtime > minAge`.
 *   5. (Опционально) `fs.rm(dir, { recursive: true, force: true })`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@bigmax/db";

const STORAGE_ROOT = path.join(process.cwd(), "public", "uploads", "products");
const PUBLIC_PREFIX = "/uploads/products";
/** Default age guard — не удаляем папки моложе 24h (in-flight upload safety). */
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface OrphanEntry {
  shard: string;
  hash: string;
  /** Файловый путь — `STORAGE_ROOT/<shard>/<hash>`. */
  dir: string;
  /** Возраст directory'и в миллисекундах (от mtime). */
  ageMs: number;
  /** Total size в bytes (для отчёта admin'у). */
  bytes: number;
}

export interface CleanupResult {
  /** Сколько папок найдено на FS всего. */
  scanned: number;
  /** Сколько reference'ится из БД (Set size). */
  referenced: number;
  /** Orphan'ы найденные после set-difference, ДО age-фильтра. */
  orphanCandidates: number;
  /** Orphan'ы, прошедшие age-guard (старше minAgeMs). */
  toDelete: OrphanEntry[];
  /** Сколько реально удалили (0 для dry-run). */
  deleted: number;
  /** Сколько байт освобождено. */
  bytesFreed: number;
  /** Errors per dir (если deletion упал на permission/race). */
  errors: Array<{ dir: string; error: string }>;
}

// --- Pure helpers -----------------------------------------------------------

/**
 * Pure: извлекает `{shard, hash}` из URL вида `/uploads/products/<shard>/<hash>/...`.
 * Возвращает `null` если URL не подпадает под формат (внешний CDN / placeholder).
 */
export function extractHashFromUrl(url: string): { shard: string; hash: string } | null {
  if (!url.startsWith(PUBLIC_PREFIX + "/")) return null;
  const tail = url.slice(PUBLIC_PREFIX.length + 1);
  const parts = tail.split("/");
  if (parts.length < 2) return null;
  const shard = parts[0];
  const hash = parts[1];
  if (!shard || !hash) return null;
  // Sanity: shard ровно 2 char, hash hex'ом 16 char (наш content-addressable format).
  // Не строжимся регексами — backfill / манифест могут иметь другой формат.
  return { shard, hash };
}

/**
 * Pure: собирает Set всех hash'ей которые reference'ятся из payload'а
 * (`{ url, sizes, avifSizes }`-ов). Один файл может reference'ить hash через
 * любой из трёх каналов, поэтому объединяем.
 */
export function collectReferencedHashes(
  rows: ReadonlyArray<{
    url: string;
    sizes: unknown;
    avifSizes: unknown;
  }>,
): Set<string> {
  const out = new Set<string>();
  const addFromUrl = (u: string): void => {
    const r = extractHashFromUrl(u);
    if (r) out.add(r.hash);
  };
  const addFromJson = (raw: unknown): void => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const v of Object.values(raw)) {
      if (typeof v === "string") addFromUrl(v);
    }
  };
  for (const row of rows) {
    addFromUrl(row.url);
    addFromJson(row.sizes);
    addFromJson(row.avifSizes);
  }
  return out;
}

// --- FS / DB I/O ------------------------------------------------------------

interface FsEntry {
  shard: string;
  hash: string;
  dir: string;
  mtimeMs: number;
  bytes: number;
}

/**
 * Walk `STORAGE_ROOT/<shard>/<hash>/`. Для каждой папки: mtime + recursive size.
 * Если STORAGE_ROOT не существует — возвращает [] (свежий dev-env / empty deploy).
 */
async function walkUploads(): Promise<FsEntry[]> {
  let shards: string[];
  try {
    shards = await fs.readdir(STORAGE_ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: FsEntry[] = [];
  for (const shard of shards) {
    if (shard.startsWith(".")) continue; // skip .gitkeep, .DS_Store
    const shardDir = path.join(STORAGE_ROOT, shard);
    let hashes: string[];
    try {
      hashes = await fs.readdir(shardDir);
    } catch {
      continue;
    }
    for (const hash of hashes) {
      if (hash.startsWith(".")) continue;
      const dir = path.join(shardDir, hash);
      let stat;
      try {
        stat = await fs.stat(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      // Recursive size — для отчёта (сколько байт освободит cleanup).
      const bytes = await dirSize(dir);
      out.push({ shard, hash, dir, mtimeMs: stat.mtimeMs, bytes });
    }
  }
  return out;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry);
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) total += await dirSize(p);
      else total += stat.size;
    } catch {
      // Skip files we can't stat (mid-delete race etc.)
    }
  }
  return total;
}

// --- Orchestrator -----------------------------------------------------------

export interface CleanupOptions {
  /** Минимальный возраст папки для удаления, ms. По умолчанию 24h. */
  minAgeMs?: number;
  /** Если true — не удаляем, только репортим. */
  dryRun?: boolean;
}

/**
 * Полный pass: scan FS → query DB → set diff → age filter → (optional) delete.
 * Возвращает структурированный отчёт (admin отображает в UI).
 */
export async function runOrphanCleanup(opts: CleanupOptions = {}): Promise<CleanupResult> {
  const minAgeMs = opts.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const dryRun = opts.dryRun ?? false;

  const [fsEntries, dbRows] = await Promise.all([
    walkUploads(),
    prisma.productImage.findMany({ select: { url: true, sizes: true, avifSizes: true } }),
  ]);

  const referenced = collectReferencedHashes(dbRows);

  const orphanCandidates = fsEntries.filter((e) => !referenced.has(e.hash));
  const now = Date.now();
  const toDelete: OrphanEntry[] = orphanCandidates
    .filter((e) => now - e.mtimeMs >= minAgeMs)
    .map((e) => ({
      shard: e.shard,
      hash: e.hash,
      dir: e.dir,
      ageMs: now - e.mtimeMs,
      bytes: e.bytes,
    }));

  const result: CleanupResult = {
    scanned: fsEntries.length,
    referenced: referenced.size,
    orphanCandidates: orphanCandidates.length,
    toDelete,
    deleted: 0,
    bytesFreed: 0,
    errors: [],
  };

  if (!dryRun) {
    for (const orphan of toDelete) {
      try {
        await fs.rm(orphan.dir, { recursive: true, force: true });
        result.deleted += 1;
        result.bytesFreed += orphan.bytes;
      } catch (err) {
        result.errors.push({
          dir: orphan.dir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}
