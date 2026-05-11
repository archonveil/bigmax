/**
 * Опции сортировки каталога. Храним как const, разделяем парсер (server)
 * и сериализатор для URL (skip `featured` как дефолт).
 *
 * `popularity` отложена до P5 — не хочется добавлять проксирование через
 * Order.items до появления реальных заказов.
 */

export const PRODUCT_SORT_OPTIONS = ["featured", "newest", "price_asc", "price_desc"] as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];

export const DEFAULT_PRODUCT_SORT: ProductSort = "featured";

export function isProductSort(raw: unknown): raw is ProductSort {
  return typeof raw === "string" && (PRODUCT_SORT_OPTIONS as readonly string[]).includes(raw);
}

export function parseProductSort(raw: string | string[] | undefined): ProductSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isProductSort(v) ? v : DEFAULT_PRODUCT_SORT;
}

/** Для querystring-генерации — дефолт не тянем в URL. */
export function sortQueryValue(sort: ProductSort): string | null {
  return sort === DEFAULT_PRODUCT_SORT ? null : sort;
}

/** Нужна ли in-memory сортировка? (Prisma не умеет _min по relation в orderBy.) */
export function sortRequiresInMemory(sort: ProductSort): boolean {
  return sort === "price_asc" || sort === "price_desc";
}
