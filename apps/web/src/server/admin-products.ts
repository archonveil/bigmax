/**
 * Admin Products — server-side helpers + Zod-схемы для CRUD из P6-T3 (§F13).
 *
 * Pure-валидаторы (CRUD body, querystring sanitize, CSV row parse) — в этом
 * модуле, в одном месте; SSR-page'и и API-routes импортируют их без
 * дублирования shape'а.
 */

import { Prisma, prisma } from "@bigmax/db";
import { z } from "zod";

import { type AttributeValue } from "@/catalog/category-attributes";
import {
  getCategoryAttributes,
  invalidateCategoryAttributesCache,
} from "@/server/category-attributes";

// Re-export validateAttributes + result type from catalog module so callers
// (POST/PATCH routes) can import everything via "@/server/admin-products".
export { validateAttributes, type AttributeValidationResult } from "@/catalog/category-attributes";

// ---------------------------------------------------------------------------
// Color auto-derivation (single source of truth = variant.color)
// ---------------------------------------------------------------------------

/**
 * Sync `Product.attributes.color` from variants:
 *  - Reads category's "color" attribute config (если есть и kind=enum/multiselect).
 *  - Берёт уникальные `variant.color` значения, оставляет только те, что
 *    canonical-match'ат option `value` (case-insensitive).
 *  - Записывает массив в `attributes.color` (storage = array, всегда).
 *  - Если ни один variant не match'нул — `color` ключ удаляется.
 *
 * Идемпотентен. Вызывается после любой mutation вариантов (create/update/
 * delete) и при изменении `Product.categoryId` (config мог измениться).
 *
 * Принципы:
 *  - **Single source of truth**: variants — источник, attributes.color —
 *    derived. Admin не настраивает color вручную в product-форме.
 *  - **Multi-color support**: товар c вариантами white/blue/red попадает
 *    под фильтр для каждого цвета (filter SQL использует array_contains).
 */
export async function syncProductColorFromVariants(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      categoryId: true,
      attributes: true,
      variants: { select: { color: true } },
    },
  });
  if (!product) return;

  const configs = await getCategoryAttributes(product.categoryId);
  const colorCfg = configs.find((c) => c.key === "color");
  if (!colorCfg || (colorCfg.kind !== "enum" && colorCfg.kind !== "multiselect")) {
    // Категория не использует color-attribute — ничего не синкаем.
    // Но если в attributes.color что-то лежит (от старой категории), стрипаем.
    const existing = (product.attributes as Record<string, unknown> | null) ?? {};
    if ("color" in existing) {
      const next = { ...existing };
      delete next.color;
      await prisma.product.update({
        where: { id: productId },
        data: {
          attributes:
            Object.keys(next).length > 0 ? (next as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    }
    return;
  }

  const allowed = new Set(colorCfg.options.map((o) => o.value.toLowerCase()));
  const colors = Array.from(
    new Set(
      product.variants
        .map((v) => v.color?.toLowerCase().trim() ?? "")
        .filter((c): c is string => c !== "" && allowed.has(c)),
    ),
  );

  const existing = (product.attributes as Record<string, unknown> | null) ?? {};
  const next: Record<string, unknown> = { ...existing };
  if (colors.length > 0) {
    next["color"] = colors;
  } else {
    delete next["color"];
  }
  // Skip update если ничего не поменялось (избегаем пустых writes).
  const before = JSON.stringify(existing["color"] ?? null);
  const after = JSON.stringify(next["color"] ?? null);
  if (before === after) return;

  await prisma.product.update({
    where: { id: productId },
    data: {
      attributes: Object.keys(next).length > 0 ? (next as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
  invalidateCategoryAttributesCache();
}

// ---------------------------------------------------------------------------
// Querystring (list page filter)
// ---------------------------------------------------------------------------

export const PRODUCTS_PAGE_SIZE = 20;

export interface AdminProductListQuery {
  /** Текстовый поиск по `name_ru` (ILIKE %q%). `null` = нет фильтра. */
  q: string | null;
  /** `null` = все, `true`/`false` = фильтр по `Product.isActive`. */
  active: boolean | null;
  /** 1-based номер страницы. */
  page: number;
}

/**
 * Парсит querystring `/admin/products?q=...&active=true&page=2`. Не throw'ит:
 * мусорные значения нормализуем (`active=foo` → null, `page=-1` → 1).
 */
export function parseAdminProductListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminProductListQuery {
  const raw = searchParams ?? {};
  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 200) : null;

  const activeRaw = pickFirst(raw["active"]);
  const active = activeRaw === "true" ? true : activeRaw === "false" ? false : null;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { q, active, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Create / Update body schemas
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const GENDER = ["unisex", "boy", "girl"] as const;

/**
 * Базовый shape для product CRUD. RU — единственный обязательный язык
 * (editorial source of truth); UZ/EN опциональны и при пустом значении
 * подменяются RU через `pickLocalized` на read-стороне.
 */
const ProductBaseSchema = z.object({
  categoryId: z.string().min(1, "category_required"),
  brandId: z.string().min(1).nullable().optional(),
  nameRu: z.string().trim().min(2, "name_ru_too_short").max(200, "name_too_long"),
  nameUz: z.string().trim().max(200, "name_too_long").optional(),
  nameEn: z.string().trim().max(200, "name_too_long").optional(),
  slug: z
    .string()
    .trim()
    .min(2, "slug_too_short")
    .max(128, "slug_too_long")
    .regex(SLUG_RE, "slug_invalid"),
  descriptionRu: z.string().max(8000).optional().nullable(),
  descriptionUz: z.string().max(8000).optional().nullable(),
  descriptionEn: z.string().max(8000).optional().nullable(),
  ageFromMonths: z.number().int().min(0).max(240).optional().nullable(),
  ageToMonths: z.number().int().min(0).max(240).optional().nullable(),
  gender: z.enum(GENDER).default("unisex"),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  /** Категория-специфичные атрибуты (P6-T3 follow-up — closes "extra
   *  feature attributes"). Зод принимает любой `Record<string, primitive>`,
   *  валидация по category-config'у — отдельным проходом в `validateAttributes`
   *  на server-side (нужен resolved category.slug). */
  attributes: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .nullable()
    .optional(),
  // Картинки товара управляются ТОЛЬКО через variant CRUD-routes (см.
  // `/api/admin/products/[id]/variants/...`). Product-level upload убрали
  // из админ-формы — все картинки теперь привязаны к конкретному варианту.
});

export const ProductCreateSchema = ProductBaseSchema.refine(
  (p) =>
    p.ageToMonths === undefined ||
    p.ageToMonths === null ||
    p.ageFromMonths === undefined ||
    p.ageFromMonths === null
      ? true
      : p.ageFromMonths <= p.ageToMonths,
  { message: "age_range_invalid", path: ["ageToMonths"] },
);
export type ProductCreate = z.infer<typeof ProductCreateSchema>;

/**
 * UpdateSchema — все поля optional, чтобы PATCH-семантика работала
 * (юзер может прислать только {isActive: false} или {nameRu: "новое"}).
 */
export const ProductUpdateSchema = ProductBaseSchema.partial().refine(
  (p) =>
    p.ageFromMonths === undefined ||
    p.ageToMonths === undefined ||
    p.ageFromMonths === null ||
    p.ageToMonths === null ||
    p.ageFromMonths <= p.ageToMonths,
  { message: "age_range_invalid", path: ["ageToMonths"] },
);
export type ProductUpdate = z.infer<typeof ProductUpdateSchema>;

// ---------------------------------------------------------------------------
// CSV import row schema
// ---------------------------------------------------------------------------

/**
 * Минимальный CSV-row: slug + name × 3 + categorySlug + опц. поля.
 * Категория ищется по slug (admin не должен помнить cuid'ы), brand тоже.
 */
export const ProductCsvRowSchema = z.object({
  slug: z.string().trim().min(2).regex(SLUG_RE, "slug_invalid"),
  name_ru: z.string().trim().min(2, "name_ru_too_short").max(200),
  name_uz: z.string().trim().max(200, "name_uz_too_long").optional(),
  name_en: z.string().trim().max(200, "name_en_too_long").optional(),
  category_slug: z.string().trim().min(1, "category_required"),
  brand_slug: z.string().trim().optional(),
  description_ru: z.string().max(8000).optional(),
  description_uz: z.string().max(8000).optional(),
  description_en: z.string().max(8000).optional(),
  age_from_months: z.coerce.number().int().min(0).max(240).optional(),
  age_to_months: z.coerce.number().int().min(0).max(240).optional(),
  gender: z.enum(GENDER).optional(),
});
export type ProductCsvRow = z.infer<typeof ProductCsvRowSchema>;

/**
 * Минимальный безопасный CSV parser: split по newlines + по comma.
 * Не поддерживает quoted fields с запятыми внутри — если в имени запятая,
 * админ должен заэкранировать через TSV (`\t` separator) в P8.
 *
 * Возвращает `{rows: rawArrayOfObjects}` или `{error}` для empty/invalid header.
 */
export function parseCsv(text: string):
  | {
      ok: true;
      rows: Array<Record<string, string>>;
      rawHeader: string[];
    }
  | {
      ok: false;
      reason: "empty" | "missing_columns";
      missing?: string[];
    } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length < 2) return { ok: false, reason: "empty" };

  const header = lines[0]!.split(",").map((h) => h.trim());
  const required = ["slug", "name_ru", "category_slug"];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) return { ok: false, reason: "missing_columns", missing };

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i]!.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j += 1) {
      const key = header[j];
      const val = cells[j] ?? "";
      if (key && val !== "") row[key] = val;
    }
    rows.push(row);
  }
  return { ok: true, rows, rawHeader: header };
}

// ---------------------------------------------------------------------------
// Server fetch
// ---------------------------------------------------------------------------

export interface AdminProductListItem {
  id: string;
  slug: string;
  nameRu: string;
  isActive: boolean;
  isFeatured: boolean;
  categoryNameRu: string;
  brandName: string | null;
  variantCount: number;
  createdAt: Date;
}

export interface AdminProductListResult {
  items: AdminProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminProducts(
  query: AdminProductListQuery,
): Promise<AdminProductListResult> {
  const where: Prisma.ProductWhereInput = {
    ...(query.q ? { nameRu: { contains: query.q, mode: "insensitive" as const } } : {}),
    ...(query.active === null ? {} : { isActive: query.active }),
  };
  const skip = (query.page - 1) * PRODUCTS_PAGE_SIZE;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PRODUCTS_PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        nameRu: true,
        isActive: true,
        isFeatured: true,
        createdAt: true,
        category: { select: { nameRu: true } },
        brand: { select: { name: true } },
        _count: { select: { variants: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      nameRu: p.nameRu,
      isActive: p.isActive,
      isFeatured: p.isFeatured,
      categoryNameRu: p.category.nameRu,
      brandName: p.brand?.name ?? null,
      variantCount: p._count.variants,
      createdAt: p.createdAt,
    })),
    total,
    page: query.page,
    pageSize: PRODUCTS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE)),
  };
}

export interface AdminProductDetail {
  id: string;
  categoryId: string;
  /** Slug категории — для разрешения attribute-config'а в форме без
   *  отдельного fetch'а dictionary'и. */
  categorySlug: string;
  brandId: string | null;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  slug: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  descriptionEn: string | null;
  ageFromMonths: number | null;
  ageToMonths: number | null;
  gender: "unisex" | "boy" | "girl";
  isActive: boolean;
  isFeatured: boolean;
  /** Категория-специфичные атрибуты — `null` если не заданы или категория
   *  не имеет config'а. */
  attributes: Record<string, AttributeValue> | null;
  /** Картинки товара, отсортированы по `order` ASC.
   *  - `colorTag` — color-group, картинка shared между всеми variant'ами с
   *    этим цветом. Primary lookup mechanism.
   *  - `variantId` — per-variant override (редко). `null` для color-tagged
   *    или product-level shared.
   *  - `sizes` — multi-size variants для srcset (Phase 5). `null` для legacy
   *    или внешних URL'ов. */
  images: Array<{
    id: string;
    url: string;
    alt: string | null;
    colorTag: string | null;
    variantId: string | null;
    sizes: Record<string, string> | null;
    avifSizes: Record<string, string> | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
  variants: Array<AdminVariant>;
}

export interface AdminVariant {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  priceCents: number;
  oldPriceCents: number | null;
  barcode: string | null;
  weightGrams: number | null;
  /** Картинки, относящиеся к этому варианту через color-tag matching
   *  (`image.colorTag === variant.color`). Включает variantId-override'ы.
   *  Storefront использует это для filtering'а галереи. */
  images: Array<{
    id: string;
    url: string;
    alt: string | null;
    colorTag: string | null;
    sizes: Record<string, string> | null;
    avifSizes: Record<string, string> | null;
  }>;
}

export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const p = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      brandId: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      slug: true,
      descriptionRu: true,
      descriptionUz: true,
      descriptionEn: true,
      ageFromMonths: true,
      ageToMonths: true,
      gender: true,
      isActive: true,
      isFeatured: true,
      attributes: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { slug: true } },
      // Все картинки товара с `colorTag` + `variantId` + `sizes` для overview-
      // display'я с badge'ами. Сортировка по глобальному `order` — единый grid.
      images: {
        select: {
          id: true,
          url: true,
          alt: true,
          colorTag: true,
          variantId: true,
          sizes: true,
          avifSizes: true,
        },
        orderBy: { order: "asc" },
      },
      variants: {
        select: {
          id: true,
          sku: true,
          color: true,
          size: true,
          priceCents: true,
          oldPriceCents: true,
          barcode: true,
          weightGrams: true,
          // variant-level картинки (only variantId-override case'ы). Color-
          // tagged картинки матчатся через color после fetch'а (см. ниже).
          images: {
            select: {
              id: true,
              url: true,
              alt: true,
              colorTag: true,
              sizes: true,
              avifSizes: true,
            },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { sku: "asc" },
      },
    },
  });
  if (!p) return null;
  const { category, attributes, images: rawImages, variants: rawVariants, ...rest } = p;
  // Normalize sizes JSON → typed `Record<string, string> | null`.
  const productImages = rawImages.map((img) => ({
    id: img.id,
    url: img.url,
    alt: img.alt,
    colorTag: img.colorTag,
    variantId: img.variantId,
    sizes: parseSizesJson(img.sizes),
    avifSizes: parseSizesJson(img.avifSizes),
  }));
  // Resolve images for each variant: color-tag match (с product-level картинок)
  // + explicit per-variant override (`variantId === v.id`, loaded via nested).
  const variantsWithMergedImages = rawVariants.map((v) => {
    const variantImages = v.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      colorTag: img.colorTag,
      sizes: parseSizesJson(img.sizes),
      avifSizes: parseSizesJson(img.avifSizes),
    }));
    const colorTagged = v.color ? productImages.filter((img) => img.colorTag === v.color) : [];
    // De-dup id'ы (если variantId-override совпадает с color-tag matching).
    const seen = new Set(variantImages.map((img) => img.id));
    const merged = [
      ...variantImages,
      ...colorTagged
        .filter((img) => !seen.has(img.id))
        .map((img) => ({
          id: img.id,
          url: img.url,
          alt: img.alt,
          colorTag: img.colorTag,
          sizes: img.sizes,
          avifSizes: img.avifSizes,
        })),
    ];
    return { ...v, images: merged };
  });
  return {
    ...rest,
    images: productImages,
    variants: variantsWithMergedImages,
    categorySlug: category.slug,
    gender: rest.gender as "unisex" | "boy" | "girl",
    attributes: (attributes as Record<string, AttributeValue> | null) ?? null,
  };
}

/** Sanitize Prisma JsonValue → `Record<string, string> | null`. */
function parseSizesJson(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface AdminProductDictionaries {
  categories: Array<{
    id: string;
    nameRu: string;
    slug: string;
    parentId: string | null;
    order: number;
  }>;
  brands: Array<{ id: string; name: string; slug: string }>;
}

/** Категории + бренды для drop-down'ов в форме. Cache 5 мин — данные
 *  меняются редко (admin вручную через separate routes), invalidate'ится
 *  через `invalidateAdminProductDictionariesCache()`. */
let dictionariesCache: { data: AdminProductDictionaries; expiresAt: number } | null = null;
const DICTIONARIES_TTL_MS = 300_000;

export function invalidateAdminProductDictionariesCache(): void {
  dictionariesCache = null;
}

export async function getAdminProductDictionaries(): Promise<AdminProductDictionaries> {
  if (dictionariesCache && dictionariesCache.expiresAt > Date.now()) {
    return dictionariesCache.data;
  }
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { nameRu: "asc" }],
      select: { id: true, nameRu: true, slug: true, parentId: true, order: true },
    }),
    prisma.brand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  const data = { categories, brands };
  dictionariesCache = { data, expiresAt: Date.now() + DICTIONARIES_TTL_MS };
  return data;
}
