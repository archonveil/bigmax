/**
 * Server-side fetcher для DB-driven category-attribute config'ов.
 *
 * Используется:
 *  - SSR-page'ом каталога (`<CategoryFilters>` принимает configs как prop);
 *  - SSR-page'ом продукта (`<AttributesTable>` принимает configs как prop);
 *  - admin-products formой (POST/PATCH validate; фронт получает configs map);
 *  - filter parser'ом URL (`parseAttributeFilters` → нужен `Set<knownKeys>`).
 *
 * Cache: в-памяти, 60-секундный TTL. Простой Map. Инвалидация на запись —
 * через `invalidateCategoryAttributesCache()`, дёргается из admin CRUD
 * route'ов после mutation. В serverless мульти-инстанс sценарии это не
 * idealно (другой инстанс увидит stale 60 секунд), но dev/single-region —
 * ОК; при необходимости заменим на Redis pub/sub.
 *
 * Pure-helpers (validate, locale-pick) живут в `@/catalog/category-attributes`;
 * этот модуль — только I/O + cache.
 */

import { prisma } from "@bigmax/db";
import type { Prisma } from "@bigmax/db";
import { unstable_cache } from "next/cache";

export const ATTRIBUTES_TAG = "attributes";

import {
  ATTRIBUTE_KINDS,
  type AttributeKind,
  type AttributeOption,
  type CategoryAttributeConfig,
} from "@/catalog/category-attributes";

// 5 минут. Cache invalidates on every CategoryAttribute mutation
// (`invalidateCategoryAttributesCache()` дёргается из admin CRUD), так что
// длинный TTL безопасен и срезает RSC-roundtrip'ы на чтениях между
// admin-edit'ами.
const CACHE_TTL_MS = 300_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateCategoryAttributesCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Mapping Prisma row → CategoryAttributeConfig
// ---------------------------------------------------------------------------

type PrismaRow = Prisma.CategoryAttributeGetPayload<Record<string, never>>;

function isAttributeKind(s: string): s is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(s);
}

function parseOptions(raw: Prisma.JsonValue | null): AttributeOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AttributeOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o["value"] !== "string" ||
      typeof o["labelRu"] !== "string" ||
      typeof o["labelUz"] !== "string" ||
      typeof o["labelEn"] !== "string"
    ) {
      continue;
    }
    const opt: AttributeOption = {
      value: o["value"],
      labelRu: o["labelRu"],
      labelUz: o["labelUz"],
      labelEn: o["labelEn"],
    };
    // Only pass through if hex format matches; admins can't smuggle arbitrary
    // CSS values.
    if (typeof o["color"] === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o["color"])) {
      opt.color = o["color"];
    }
    out.push(opt);
  }
  return out;
}

export function mapRowToConfig(row: PrismaRow): CategoryAttributeConfig | null {
  if (!isAttributeKind(row.kind)) return null;
  const base = {
    id: row.id,
    categoryId: row.categoryId,
    key: row.key,
    labelRu: row.labelRu,
    labelUz: row.labelUz,
    labelEn: row.labelEn,
    helpTextRu: row.helpTextRu,
    helpTextUz: row.helpTextUz,
    helpTextEn: row.helpTextEn,
    isRequired: row.isRequired,
    isFilterable: row.isFilterable,
    order: row.order,
  };
  if (row.kind === "enum") {
    return { ...base, kind: "enum", options: parseOptions(row.options) };
  }
  if (row.kind === "multiselect") {
    return { ...base, kind: "multiselect", options: parseOptions(row.options) };
  }
  if (row.kind === "range") {
    return {
      ...base,
      kind: "range",
      min: row.min,
      max: row.max,
      step: row.step,
      unitRu: row.unitRu,
      unitUz: row.unitUz,
      unitEn: row.unitEn,
    };
  }
  if (row.kind === "boolean") return { ...base, kind: "boolean" };
  return { ...base, kind: "text" };
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

/**
 * Атрибуты, определённые именно на этой категории (без inheritance).
 * Используется admin'ом и как строительный блок merged-fetcher'а.
 */
async function getOwnCategoryAttributes(categoryId: string): Promise<CategoryAttributeConfig[]> {
  const key = `own:${categoryId}`;
  const cached = getCache<CategoryAttributeConfig[]>(key);
  if (cached) return cached;
  const rows = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const configs = rows.map(mapRowToConfig).filter((c): c is CategoryAttributeConfig => c !== null);
  setCache(key, configs);
  return configs;
}

/**
 * Возвращает цепочку родителей (root → … → categoryId) — нужно для
 * merge-resolve атрибутов. Защитный cap в 16 уровней.
 */
async function getCategoryAncestorChain(categoryId: string): Promise<string[]> {
  const key = `chain:${categoryId}`;
  const cached = getCache<string[]>(key);
  if (cached) return cached;
  const chain: string[] = [];
  let currentId: string | null = categoryId;
  for (let i = 0; i < 16 && currentId !== null; i += 1) {
    chain.unshift(currentId);
    const row: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!row) break;
    currentId = row.parentId;
  }
  setCache(key, chain);
  return chain;
}

/**
 * Возвращает атрибут-конфиги для конкретной category-id, с учётом
 * наследования от родительских категорий. Дочерние атрибуты с тем же
 * `key` перекрывают родительские (override-семантика). Cache 60 сек.
 *
 * `categoryId` в возвращённом конфиге = категория, где он ОПРЕДЕЛЁН
 * (т.е. может быть != требуемому id для inherited-атрибутов). UI
 * использует это, чтобы пометить inherited row'ы.
 */
export async function getCategoryAttributes(
  categoryId: string,
): Promise<CategoryAttributeConfig[]> {
  const key = `cat:${categoryId}`;
  const cached = getCache<CategoryAttributeConfig[]>(key);
  if (cached) return cached;
  const chain = await getCategoryAncestorChain(categoryId);
  // root → leaf, child overrides parent.
  const byKey = new Map<string, CategoryAttributeConfig>();
  for (const id of chain) {
    const own = await getOwnCategoryAttributes(id);
    for (const cfg of own) byKey.set(cfg.key, cfg);
  }
  const merged = Array.from(byKey.values()).sort((a, b) => a.order - b.order);
  setCache(key, merged);
  return merged;
}

export async function getCategoryAttributesBySlug(
  slug: string,
): Promise<CategoryAttributeConfig[]> {
  const key = `slug:${slug}`;
  const cached = getCache<CategoryAttributeConfig[]>(key);
  if (cached) return cached;
  const cat = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (!cat) {
    setCache(key, []);
    return [];
  }
  const configs = await getCategoryAttributes(cat.id);
  setCache(key, configs);
  return configs;
}

/**
 * Возвращает Set всех известных attribute-keys (для filter parser'а).
 * P1-16: кешируем через `unstable_cache` (тег `attributes`, TTL 1 час).
 * Инвалидация — `revalidateTag('attributes')` из admin/categories/[id]/attributes
 * CRUD ручек. Внутренний cache вернёт `string[]` (Set не сериализуется),
 * shim снаружи строит Set.
 */
const getAllAttributeKeysCached = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.categoryAttribute.findMany({
      select: { key: true },
      distinct: ["key"],
    });
    return rows.map((r) => r.key);
  },
  ["all-attribute-keys"],
  { revalidate: 3600, tags: [ATTRIBUTES_TAG] },
);

export async function getAllAttributeKeys(): Promise<Set<string>> {
  return new Set(await getAllAttributeKeysCached());
}

/**
 * Map<categoryId, configs[]> для admin product form'ы (pre-fetch all).
 * Каждая запись уже учитывает inheritance — admin при смене категории в
 * product-form'е видит и собственные, и родительские атрибуты.
 */
export async function getCategoryAttributesMap(): Promise<Map<string, CategoryAttributeConfig[]>> {
  const key = "all-by-cat";
  const cached = getCache<Map<string, CategoryAttributeConfig[]>>(key);
  if (cached) return cached;

  const categories = await prisma.category.findMany({
    select: { id: true, parentId: true },
  });
  const parentById = new Map<string, string | null>();
  for (const c of categories) parentById.set(c.id, c.parentId);

  // Pre-fetch own attrs for each category in one go (avoids N round-trips).
  const allRows = await prisma.categoryAttribute.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const ownByCategory = new Map<string, CategoryAttributeConfig[]>();
  for (const r of allRows) {
    const cfg = mapRowToConfig(r);
    if (!cfg) continue;
    const list = ownByCategory.get(r.categoryId) ?? [];
    list.push(cfg);
    ownByCategory.set(r.categoryId, list);
  }

  const map = new Map<string, CategoryAttributeConfig[]>();
  for (const cat of categories) {
    const byKey = new Map<string, CategoryAttributeConfig>();
    // Walk root → leaf, child overrides parent.
    const chain: string[] = [];
    let cur: string | null = cat.id;
    for (let i = 0; i < 16 && cur !== null; i += 1) {
      chain.unshift(cur);
      cur = parentById.get(cur) ?? null;
    }
    for (const id of chain) {
      for (const cfg of ownByCategory.get(id) ?? []) byKey.set(cfg.key, cfg);
    }
    const merged = Array.from(byKey.values()).sort((a, b) => a.order - b.order);
    map.set(cat.id, merged);
  }
  setCache(key, map);
  return map;
}
