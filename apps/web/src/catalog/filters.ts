/**
 * Zod-схемы + билдер Prisma.ProductWhereInput для фильтров каталога.
 * Shared между server-side (page.tsx парсит searchParams) и client UI
 * (CategoryFilters синхронизирует URL).
 */

import type { Prisma } from "@bigmax/db";
import { GenderSchema, sumToCents } from "@bigmax/shared-types";
import { z } from "zod";

export const AGE_PRESETS = ["any", "0-6", "6-12", "12-24", "24+"] as const;
export type AgePreset = (typeof AGE_PRESETS)[number];

export const GENDER_FILTERS = ["any", "unisex", "boy", "girl"] as const;
export type GenderFilter = (typeof GENDER_FILTERS)[number];

/** Диапазон в месяцах. `null` у `to` означает «без верхней границы». */
const AGE_RANGES: Record<AgePreset, { from: number; to: number | null }> = {
  any: { from: 0, to: null },
  "0-6": { from: 0, to: 6 },
  "6-12": { from: 6, to: 12 },
  "12-24": { from: 12, to: 24 },
  "24+": { from: 24, to: null },
};

const coerceIntPositive = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  })
  .optional();

const coerceStringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return [] as string[];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((s) => s.trim()).filter(Boolean);
  });

const coerceBool = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "true" || v === "1");

export const CategoryFiltersSchema = z.object({
  /** Цена в сумах (UI), внутри конвертим в тийны для БД. */
  minPrice: coerceIntPositive,
  maxPrice: coerceIntPositive,
  brand: coerceStringArray,
  age: z.enum(AGE_PRESETS).default("any"),
  gender: z.enum(GENDER_FILTERS).default("any"),
  inStock: coerceBool,
});

export type CategoryFilters = z.infer<typeof CategoryFiltersSchema>;

/**
 * Значение фильтра по атрибуту:
 *  - exact (enum/bool) → `string` (bool-`true` = строка "true");
 *  - multiselect (несколько значений, OR-семантика) → `string[]`;
 *  - range (numeric) → `{min?:number, max?:number}`.
 */
export type AttributeFilter = { min?: number; max?: number } | string | string[];

export type AttributeFilters = Record<string, AttributeFilter>;

/**
 * Парсит URL-параметры вида `attr.<key>=val`, `attr.<key>.min=X`, `attr.<key>.max=Y`.
 * Игнорирует неизвестные ключи (не из `knownKeys`) — защита от URL-мусора.
 *
 * `knownKeys` — Set всех существующих attribute-keys (DB-driven). SSR-page
 * получает его через `getAllAttributeKeys()` из `@/server/category-attributes`.
 */
export function parseAttributeFilters(
  searchParams: Record<string, string | string[] | undefined>,
  knownKeys: ReadonlySet<string>,
): AttributeFilters {
  const out: AttributeFilters = {};

  for (const [rawKey, rawVal] of Object.entries(searchParams)) {
    if (!rawKey.startsWith("attr.")) continue;
    if (rawVal === undefined) continue;

    const parts = rawKey.slice("attr.".length).split(".");
    const key = parts[0];
    if (!key || !knownKeys.has(key)) continue;

    if (parts.length === 1) {
      // Exact / multiselect:
      //  - `attr.key=val` (single string) → exact `string`;
      //  - `attr.key=a&attr.key=b` (array) → multiselect `string[]`;
      //  - empty values отфильтровываем, дубликаты dedupe-аем.
      if (Array.isArray(rawVal)) {
        const cleaned = Array.from(new Set(rawVal.filter((v) => v !== "")));
        if (cleaned.length === 1) out[key] = cleaned[0]!;
        else if (cleaned.length > 1) out[key] = cleaned;
      } else {
        if (rawVal !== "") out[key] = rawVal;
      }
    } else if (parts[1] === "min" || parts[1] === "max") {
      const val = Array.isArray(rawVal) ? rawVal[0] : rawVal;
      if (val === undefined || val === "") continue;
      const n = Number.parseInt(val, 10);
      if (!Number.isFinite(n) || n < 0) continue;
      const existing =
        typeof out[key] === "object" && !Array.isArray(out[key])
          ? (out[key] as { min?: number; max?: number })
          : {};
      out[key] = { ...existing, [parts[1]]: n };
    }
  }

  return out;
}

/** Обратный сериализатор attribute-фильтров в querystring (без `?`). */
export function buildAttributeFiltersQueryString(filters: AttributeFilters): string {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (typeof val === "string") {
      if (val.length > 0) params.set(`attr.${key}`, val);
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (v.length > 0) params.append(`attr.${key}`, v);
      }
    } else {
      if (val.min !== undefined) params.set(`attr.${key}.min`, String(val.min));
      if (val.max !== undefined) params.set(`attr.${key}.max`, String(val.max));
    }
  }
  return params.toString();
}

export function hasActiveAttributeFilters(filters: AttributeFilters): boolean {
  for (const val of Object.values(filters)) {
    if (typeof val === "string") {
      if (val.length > 0) return true;
    } else if (Array.isArray(val)) {
      if (val.length > 0) return true;
    } else if (val.min !== undefined || val.max !== undefined) {
      return true;
    }
  }
  return false;
}

export function parseCategoryFilters(
  searchParams: Record<string, string | string[] | undefined>,
): CategoryFilters {
  const parsed = CategoryFiltersSchema.safeParse({
    minPrice: searchParams["minPrice"],
    maxPrice: searchParams["maxPrice"],
    brand: searchParams["brand"],
    age: searchParams["age"],
    gender: searchParams["gender"],
    inStock: searchParams["inStock"],
  });
  if (parsed.success) return parsed.data;
  // Невалидные фильтры эквивалентны отсутствию — не ломаем страницу.
  return {
    minPrice: undefined,
    maxPrice: undefined,
    brand: [],
    age: "any",
    gender: "any",
    inStock: false,
  };
}

/** Пустой `AttributeFilters`-дефолт. */
export const EMPTY_ATTRIBUTE_FILTERS: AttributeFilters = {};

/** Строит полный querystring — поддерживает повторяющиеся `brand` параметры. */
export function buildFiltersQueryString(
  f: CategoryFilters,
  attributes: AttributeFilters = {},
): string {
  const params = new URLSearchParams();
  if (f.minPrice !== undefined) params.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== undefined) params.set("maxPrice", String(f.maxPrice));
  for (const b of f.brand) params.append("brand", b);
  if (f.age !== "any") params.set("age", f.age);
  if (f.gender !== "any") params.set("gender", f.gender);
  if (f.inStock) params.set("inStock", "true");

  const attrsQs = buildAttributeFiltersQueryString(attributes);
  if (attrsQs.length > 0) {
    const extra = new URLSearchParams(attrsQs);
    for (const [k, v] of extra) params.append(k, v);
  }
  return params.toString();
}

/** Есть ли у юзера активные фильтры (для подсветки «Сбросить»). */
export function hasActiveFilters(f: CategoryFilters, attributes: AttributeFilters = {}): boolean {
  return (
    f.minPrice !== undefined ||
    f.maxPrice !== undefined ||
    f.brand.length > 0 ||
    f.age !== "any" ||
    f.gender !== "any" ||
    f.inStock === true ||
    hasActiveAttributeFilters(attributes)
  );
}

/**
 * Строит Prisma WhereInput с учётом агрегированных category-ids
 * (parent + прямые дети, уже вычислены в getProductsByCategory) и
 * активных фильтров.
 */
export function buildProductWhere(
  categoryIds: readonly string[],
  f: CategoryFilters,
  attributes: AttributeFilters = {},
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    categoryId: { in: [...categoryIds] },
  };

  // --- Brand (OR внутри списка брендов) ---
  if (f.brand.length > 0) {
    where.brand = { slug: { in: f.brand } };
  }

  // --- Gender: boy/girl расширяем unisex'ом (товары без ограничения по полу
  //     тоже релевантны), unisex — строго. ---
  if (f.gender === "boy" || f.gender === "girl") {
    where.gender = { in: [f.gender, GenderSchema.enum.unisex] };
  } else if (f.gender === "unisex") {
    where.gender = GenderSchema.enum.unisex;
  }

  // --- Age: пересечение интервала товара с фильтром.
  //     product.ageFromMonths <= filter.to (если есть)
  //     product.ageToMonths   >= filter.from (если есть)
  //     null-поля товара = нет ограничения. ---
  const range = AGE_RANGES[f.age];
  if (f.age !== "any") {
    const andConds: Prisma.ProductWhereInput[] = [];
    if (range.to !== null) {
      andConds.push({
        OR: [{ ageFromMonths: null }, { ageFromMonths: { lte: range.to } }],
      });
    }
    andConds.push({
      OR: [{ ageToMonths: null }, { ageToMonths: { gte: range.from } }],
    });
    where.AND = andConds;
  }

  // --- Price: хотя бы один вариант в диапазоне. User-input в сумах → тийны. ---
  const priceFilter: Prisma.IntFilter | undefined =
    f.minPrice !== undefined || f.maxPrice !== undefined
      ? {
          ...(f.minPrice !== undefined ? { gte: sumToCents(f.minPrice) } : {}),
          ...(f.maxPrice !== undefined ? { lte: sumToCents(f.maxPrice) } : {}),
        }
      : undefined;

  // --- In-stock: хотя бы один вариант с quantity > 0 ---
  if (priceFilter || f.inStock) {
    where.variants = {
      some: {
        ...(priceFilter ? { priceCents: priceFilter } : {}),
        ...(f.inStock ? { stock: { some: { quantity: { gt: 0 } } } } : {}),
      },
    };
  }

  // --- Attribute filters (JSON path). Prisma синтаксис:
  //     `attributes: { path: ["fabric"], equals: "cotton" }` для exact;
  //     `array_contains: "white"` для multiselect-array хранения;
  //     для range используем `{ path:[...], gte: N }` + `{ lte: N }`.
  //     Для boolean: "true"/"false" в URL → cast к boolean здесь.
  //
  //     Для string-значений мы делаем OR(equals, array_contains) — не зная
  //     kind атрибута здесь, поддерживаем ОБА storage-формата:
  //       - enum/scalar: `attributes.color = "white"` → equals совпадает
  //       - multiselect/array: `attributes.color = ["white", "blue"]` →
  //         array_contains совпадает
  //     Т.е. один и тот же URL `?attr.color=white` корректно фильтрует
  //     товары с любым из storage-представлений. ---
  const attrConds: Prisma.ProductWhereInput[] = [];
  for (const [key, val] of Object.entries(attributes)) {
    if (typeof val === "string") {
      if (val.length === 0) continue;
      if (val === "true") {
        attrConds.push({ attributes: { path: [key], equals: true } });
      } else if (val === "false") {
        attrConds.push({ attributes: { path: [key], equals: false } });
      } else {
        attrConds.push({
          OR: [
            { attributes: { path: [key], equals: val } },
            { attributes: { path: [key], array_contains: val } },
          ],
        });
      }
    } else if (Array.isArray(val)) {
      // Multiselect: OR-семантика (товар матчит, если у него хотя бы одно
      // из выбранных значений). Каждое значение проверяем по обеим
      // storage-формам (scalar + array_contains).
      const ors: Prisma.ProductWhereInput[] = [];
      for (const v of val) {
        if (v.length === 0) continue;
        ors.push({ attributes: { path: [key], equals: v } });
        ors.push({ attributes: { path: [key], array_contains: v } });
      }
      if (ors.length > 0) attrConds.push({ OR: ors });
    } else {
      if (val.min !== undefined) {
        attrConds.push({ attributes: { path: [key], gte: val.min } });
      }
      if (val.max !== undefined) {
        attrConds.push({ attributes: { path: [key], lte: val.max } });
      }
    }
  }
  if (attrConds.length > 0) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...attrConds];
  }

  return where;
}
