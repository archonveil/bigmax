/**
 * Server-only запросы к каталогу. Держим их в одном месте, чтобы Home
 * (и позже Catalog / Product-страницы) не писали Prisma-запросы прямо
 * в компонентах.
 *
 * Все функции возвращают узкие DTO'шки — не всю Prisma-модель — чтобы
 * контролировать размер RSC-payload'а и избежать утечки полей типа
 * `passwordHash` в сторонних таблицах в будущем.
 */

import { prisma, type Prisma } from "@bigmax/db";
import { unstable_cache } from "next/cache";

import { buildProductWhere, type AttributeFilters, type CategoryFilters } from "@/catalog/filters";
import { DEFAULT_PRODUCT_SORT, sortRequiresInMemory, type ProductSort } from "@/catalog/sort";

export interface CategoryCard {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
}

/**
 * Recursive shape — поддерживает произвольную глубину иерархии. Заменяет
 * прежний `CategoryWithChildren` (который был фикс-2-уровневый). Дерево
 * строится один раз через `buildCategoryTree(rows)` из плоского списка.
 */
export interface CategoryNode extends CategoryCard {
  children: CategoryNode[];
}

/** @deprecated — оставлен как алиас на `CategoryNode` для backward-compat. */
export type CategoryWithChildren = CategoryNode;

export interface CategoryDetail extends CategoryCard {
  parent: CategoryCard | null;
  /**
   * Полная цепочка предков от root до прямого parent'а. Пустой массив если
   * категория — root. Используется в breadcrumb'ах и JSON-LD на любой глубине.
   */
  ancestors: CategoryCard[];
  children: CategoryCard[];
}

/**
 * Pure: строит nested tree из плоского списка категорий. Каждая row должна
 * содержать `id`, `parentId`, и CategoryCard-поля. Не зависит от Prisma —
 * работает на любом источнике данных (тесты, мемоизированный кэш).
 */
export function buildCategoryTree(
  rows: ReadonlyArray<CategoryCard & { parentId: string | null }>,
): CategoryNode[] {
  // Map id → node для O(1) lookup. Children сначала пустые, наполняются
  // во втором проходе.
  const nodeById = new Map<string, CategoryNode>();
  for (const r of rows) {
    nodeById.set(r.id, {
      id: r.id,
      slug: r.slug,
      nameRu: r.nameRu,
      nameUz: r.nameUz,
      nameEn: r.nameEn,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const r of rows) {
    const node = nodeById.get(r.id)!;
    if (r.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeById.get(r.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan parent → treat as root (defensive)
    }
  }
  return roots;
}

/**
 * Pure: рекурсивно собирает все descendant-ID'ы (включая саму root'у).
 * Используется в `getProductsByCategory` для transitive product filtering —
 * товары всех потомков на любой глубине.
 */
export function collectDescendantIds(roots: CategoryNode[], rootId: string): string[] {
  const ids: string[] = [];
  function find(nodes: CategoryNode[]): CategoryNode | null {
    for (const n of nodes) {
      if (n.id === rootId) return n;
      const inner = find(n.children);
      if (inner) return inner;
    }
    return null;
  }
  const start = find(roots);
  if (!start) return [rootId]; // root not in tree — caller'у вернётся хотя бы сам id
  function walk(node: CategoryNode): void {
    ids.push(node.id);
    for (const c of node.children) walk(c);
  }
  walk(start);
  return ids;
}

export interface BrandCard {
  id: string;
  slug: string;
  name: string;
  country: string | null;
}

export interface ProductCardVariant {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  priceCents: number;
  oldPriceCents: number | null;
  stockQuantity: number;
  /** Первая variant-level картинка (если есть). Для swatch-hover на катaloge-
   *  карточке — image swap при выборе цвета. `null` означает fallback на
   *  product-level imageUrl. */
  imageUrl: string | null;
  /** WebP multi-size variants для srcset карточки. */
  imageSizes: Record<string, string> | null;
  /** AVIF multi-size variants. */
  imageAvifSizes: Record<string, string> | null;
}

export interface ProductCardDTO {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  minPriceCents: number;
  imageUrl: string | null;
  /** WebP multi-size variants для primary картинки card'а. */
  imageSizes: Record<string, string> | null;
  /** AVIF multi-size variants для primary картинки card'а. */
  imageAvifSizes: Record<string, string> | null;
  /**
   * До 10 вариантов (отсортированы по priceCents asc). Нужны inline-контролам
   * на карточке: если `variants.length > 1` — рендерим chip-picker, иначе
   * одну кнопку «В корзину». `defaultVariant` ниже = `variants[0]`.
   */
  variants: ProductCardVariant[];
  /**
   * Дефолтный вариант для inline-add-to-cart — самый дешёвый
   * (соответствует minPriceCents). null если у товара нет вариантов.
   */
  defaultVariant: ProductCardVariant | null;
}

/** @deprecated — используй `ProductCardDTO`; оставлено для обратной совместимости. */
export type FeaturedProduct = ProductCardDTO;

/** Дефолтный размер страницы. UI позволяет юзеру выбрать из PAGE_SIZE_OPTIONS. */
export const CATEGORY_PAGE_SIZE = 24;
export const PAGE_SIZE_OPTIONS = [24, 48, 60] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export function isPageSizeOption(n: number): n is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n);
}

export interface PaginatedProducts {
  items: ProductCardDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductVariantDTO {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  priceCents: number;
  oldPriceCents: number | null;
  weightGrams: number | null;
  stockQuantity: number;
}

export interface ProductImageDTO {
  id: string;
  url: string;
  alt: string | null;
  order: number;
  /** Color-group tag (например, "red"). Картинка показывается на всех
   *  вариантах с этим color'ом — основной механизм grouping'а. */
  colorTag: string | null;
  /** Per-variant override. Используется редко (специфичное фото только для
   *  одного артикула, где color-tag не применим). `null` для color-tagged
   *  или product-level shared картинок. */
  variantId: string | null;
  /** WebP multi-size variants для srcset-delivery (Phase 5):
   *  `{ w400: "/uploads/.../w400.webp", w800: "...", w1280: "...", w1920: "..." }`.
   *  Если задан → `<ProductImage>` рендерит native `<img srcset>` или `<picture>`
   *  напрямую без `/_next/image` round-trip'а. */
  sizes: Record<string, string> | null;
  /** AVIF multi-size variants (Phase 5b): тот же набор breakpoints. Когда
   *  И `sizes`, И `avifSizes` есть — рендерится `<picture><source type=
   *  "image/avif">...<source type="image/webp">...<img></picture>`. */
  avifSizes: Record<string, string> | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  descriptionEn: string | null;
  ageFromMonths: number | null;
  ageToMonths: number | null;
  gender: "unisex" | "boy" | "girl";
  attributes: Record<string, string | number | boolean | string[]> | null;
  category: CategoryCard & {
    parent: CategoryCard | null;
    /** Полная цепочка предков (root → … → direct parent), пустая для root-категории. */
    ancestors: CategoryCard[];
  };
  brand: { slug: string; name: string } | null;
  variants: ProductVariantDTO[];
  images: ProductImageDTO[];
}

// P1-11/P2-25: taxonomy reads — кешируем на 10 минут с тегом `taxonomy`.
// Inval'идация в admin-CRUD ручках brands/categories через `revalidateTag`.
export const TAXONOMY_TAG = "taxonomy";

export const getActiveCategories = unstable_cache(
  async (): Promise<CategoryCard[]> => {
    return prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { order: "asc" },
      select: { id: true, slug: true, nameRu: true, nameUz: true, nameEn: true },
    });
  },
  ["active-categories"],
  { revalidate: 600, tags: [TAXONOMY_TAG] },
);

/**
 * Полное дерево категорий произвольной глубины. Тащим ВСЕ active rows одним
 * findMany и строим nested tree в JS через `buildCategoryTree`. Это дешевле
 * recursive CTE при catalog'е < 100 категорий и проще для теста.
 *
 * Кэш: 10 мин + tag `taxonomy`. Inval'идация — из admin-CRUD ручек категорий
 * через `revalidateTag`.
 */
let _categoryTreeCache: { data: CategoryNode[]; at: number } | null = null;
const CATEGORY_TREE_TTL = 600_000; // 10 min in ms

export async function getCategoryTree(): Promise<CategoryNode[]> {
  const now = Date.now();
  if (_categoryTreeCache && now - _categoryTreeCache.at < CATEGORY_TREE_TTL) {
    return _categoryTreeCache.data;
  }
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ parentId: "asc" }, { order: "asc" }],
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      parentId: true,
    },
  });
  const data = buildCategoryTree(rows);
  _categoryTreeCache = { data, at: now };
  return data;
}

export const getActiveBrands = unstable_cache(
  async (): Promise<BrandCard[]> => {
    return prisma.brand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true, country: true },
    });
  },
  ["active-brands"],
  { revalidate: 600, tags: [TAXONOMY_TAG] },
);

// P0-6: убрали `stock: { select }` из per-card include — оставляли по 1 row
// на (variant × branch) на каждую карточку → 360+ rows на 24-card странице
// в RSC-payload'е лишь чтобы посчитать «available?». Теперь stock-aggregate
// делается одним `prisma.stock.groupBy` на страницу через `attachStockToCards`.
const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  nameRu: true,
  nameUz: true,
  nameEn: true,
  brand: { select: { name: true } },
  variants: {
    // До 10 вариантов по возрастанию цены — для chip-picker'а на карточке.
    select: {
      id: true,
      sku: true,
      color: true,
      size: true,
      priceCents: true,
      oldPriceCents: true,
    },
    orderBy: { priceCents: "asc" },
    take: 10,
  },
  // ВСЕ картинки товара (включая color-tagged) — нужны для resolve'а
  // variant.imageUrl через color-tag mapping в `toProductCardDTO`. Take/limit
  // нет: товар редко имеет >20 картинок, и storefront-card берёт по 1 на цвет.
  images: {
    select: {
      url: true,
      colorTag: true,
      variantId: true,
      sizes: true,
      avifSizes: true,
    },
    orderBy: { order: "asc" },
  },
} as const;

type RawProductCard = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brand: { name: string } | null;
  variants: {
    id: string;
    sku: string;
    color: string | null;
    size: string | null;
    priceCents: number;
    oldPriceCents: number | null;
  }[];
  images: {
    url: string;
    colorTag: string | null;
    variantId: string | null;
    sizes: unknown;
    avifSizes: unknown;
  }[];
};

/**
 * Один `prisma.stock.groupBy` агрегирует quantity/reserved по variantId
 * для всех товаров текущей страницы. Возвращает Map<variantId, available>,
 * где `available = max(0, sumQuantity - sumReserved)` — сумма-сумма-разница
 * корректнее, чем per-row max() (если один branch в минусе из-за расхождения,
 * surplus с другого не теряем).
 */
async function fetchAvailableByVariant(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const grouped = await prisma.stock.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds } },
    _sum: { quantity: true, reserved: true },
  });
  const map = new Map<string, number>();
  for (const row of grouped) {
    const q = row._sum.quantity ?? 0;
    const r = row._sum.reserved ?? 0;
    map.set(row.variantId, Math.max(0, q - r));
  }
  return map;
}

/** Пустой map для путей, где stockQuantity не используется (favorites snapshot). */
const EMPTY_STOCK_MAP: ReadonlyMap<string, number> = new Map();

function toProductCardDTO(
  p: RawProductCard,
  stockByVariant: ReadonlyMap<string, number>,
): ProductCardDTO {
  // Index картинок по color-tag и по variantId — для O(1) lookup'а первой
  // картинки + sizes + avifSizes по color'у конкретного варианта.
  interface ImgEntry {
    url: string;
    sizes: Record<string, string> | null;
    avifSizes: Record<string, string> | null;
  }
  const firstByColor = new Map<string, ImgEntry>();
  const firstByVariantId = new Map<string, ImgEntry>();
  const productLevelImages: ImgEntry[] = [];
  for (const img of p.images) {
    const entry: ImgEntry = {
      url: img.url,
      sizes: parseSizesJson(img.sizes),
      avifSizes: parseSizesJson(img.avifSizes),
    };
    if (img.colorTag !== null && !firstByColor.has(img.colorTag)) {
      firstByColor.set(img.colorTag, entry);
    } else if (img.variantId !== null && !firstByVariantId.has(img.variantId)) {
      firstByVariantId.set(img.variantId, entry);
    } else if (img.colorTag === null && img.variantId === null) {
      productLevelImages.push(entry);
    }
  }
  const variants: ProductCardVariant[] = p.variants.map((v) => {
    // Resolve order: color-tag → variantId-override → product-level.
    const byColor = v.color !== null ? firstByColor.get(v.color) : undefined;
    const byVariant = firstByVariantId.get(v.id);
    const resolved = byColor ?? byVariant ?? productLevelImages[0] ?? null;
    return {
      id: v.id,
      sku: v.sku,
      color: v.color,
      size: v.size,
      priceCents: v.priceCents,
      oldPriceCents: v.oldPriceCents,
      stockQuantity: stockByVariant.get(v.id) ?? 0,
      imageUrl: resolved?.url ?? null,
      imageSizes: resolved?.sizes ?? null,
      imageAvifSizes: resolved?.avifSizes ?? null,
    };
  });
  const defaultVariant = variants[0] ?? null;
  const productLevelPrimary = productLevelImages[0] ?? null;
  const firstVariantImage = variants.find((v) => v.imageUrl !== null) ?? null;
  return {
    id: p.id,
    slug: p.slug,
    nameRu: p.nameRu,
    nameUz: p.nameUz,
    nameEn: p.nameEn,
    brandName: p.brand?.name ?? null,
    minPriceCents: defaultVariant?.priceCents ?? 0,
    imageUrl: productLevelPrimary?.url ?? firstVariantImage?.imageUrl ?? null,
    imageSizes: productLevelPrimary?.sizes ?? firstVariantImage?.imageSizes ?? null,
    imageAvifSizes: productLevelPrimary?.avifSizes ?? firstVariantImage?.imageAvifSizes ?? null,
    variants,
    defaultVariant,
  };
}

/**
 * Хелпер: berёт raw-products, делает один `stock.groupBy` для всех variantId,
 * и возвращает массив DTO. Этот pattern переиспользуется в `getFeaturedProducts`,
 * `getProductsByCategory`, `getFavoritesForUser` и любых других card-листингах.
 */
async function buildCardsWithStock(rawProducts: RawProductCard[]): Promise<ProductCardDTO[]> {
  const variantIds = rawProducts.flatMap((p) => p.variants.map((v) => v.id));
  const stockByVariant = await fetchAvailableByVariant(variantIds);
  return rawProducts.map((p) => toProductCardDTO(p, stockByVariant));
}

export async function getFeaturedProducts(limit = 8): Promise<ProductCardDTO[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true, isFeatured: true },
    take: limit,
    orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
    select: PRODUCT_CARD_SELECT,
  });
  return buildCardsWithStock(products);
}

/**
 * Детали категории: сама + immediate parent + дети + **полная цепочка предков**
 * (root → … → direct parent) для breadcrumb'ов произвольной глубины.
 *
 * Ancestors собираются walk'ом по plain-tree (`getCategoryTree`-output)
 * — это один in-memory обход cached-кэша, без дополнительных queries.
 *
 * Возвращает null для неизвестного / неактивного slug'а.
 */
export async function getCategoryBySlug(slug: string): Promise<CategoryDetail | null> {
  const c = await prisma.category.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      isActive: true,
      parent: {
        select: { id: true, slug: true, nameRu: true, nameUz: true, nameEn: true },
      },
      children: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, slug: true, nameRu: true, nameUz: true, nameEn: true },
      },
    },
  });
  if (!c || !c.isActive) return null;
  const { isActive: _, parent, children, ...rest } = c;

  // Ancestors — full chain от root до direct parent. Walk через cached
  // tree (стоимость: 0 query'ев, in-memory). Root → ancestors=[].
  const tree = await getCategoryTree();
  const ancestors = findAncestorChain(tree, c.id);

  return { ...rest, parent, ancestors, children };
}

/**
 * Pure: возвращает массив CategoryCard'ов от корневого до прямого parent'а
 * (current НЕ включается). Если узел не найден или это root — `[]`.
 */
export function findAncestorChain(roots: CategoryNode[], targetId: string): CategoryCard[] {
  const path: CategoryNode[] = [];
  function dfs(nodes: CategoryNode[]): boolean {
    for (const n of nodes) {
      path.push(n);
      if (n.id === targetId) return true;
      if (dfs(n.children)) return true;
      path.pop();
    }
    return false;
  }
  if (!dfs(roots)) return [];
  // path сейчас содержит root..current; убираем current'а (последний).
  return path.slice(0, -1).map((n) => ({
    id: n.id,
    slug: n.slug,
    nameRu: n.nameRu,
    nameUz: n.nameUz,
    nameEn: n.nameEn,
  }));
}

/**
 * Получить товары категории с пагинацией. **Включаем товары ВСЕХ потомков**
 * на любой глубине — посетив прадеда, юзер видит товары всей иерархии.
 * Descendant IDs собираются через `collectDescendantIds` поверх cached-tree.
 * Сортировка: featured сверху, потом по свежести.
 */
function orderByForSort(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "newest":
      return [{ createdAt: "desc" }];
    case "featured":
    default:
      // price_asc/price_desc обрабатываются через `productVariant.groupBy` —
      // см. ниже. Этот case даёт стабильный SQL-порядок для остальных видов.
      return [{ isFeatured: "desc" }, { updatedAt: "desc" }];
  }
}

export async function getProductsByCategory(
  categoryId: string,
  {
    page = 1,
    pageSize = CATEGORY_PAGE_SIZE,
    filters,
    attributes,
    sort = DEFAULT_PRODUCT_SORT,
  }: {
    page?: number;
    pageSize?: number;
    filters?: CategoryFilters;
    attributes?: AttributeFilters;
    sort?: ProductSort;
  } = {},
): Promise<PaginatedProducts> {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));

  // Multi-level: тащим cached-tree и собираем ВСЕ descendant-IDs (root + дети
  // + внуки + …). Раньше брали только direct children — товары внуков
  // отсутствовали на странице прадеда.
  const tree = await getCategoryTree();
  const categoryIds = collectDescendantIds(tree, categoryId);

  const where = filters
    ? buildProductWhere(categoryIds, filters, attributes)
    : { isActive: true, categoryId: { in: categoryIds } };

  // P0-7: для price_asc/price_desc используем `productVariant.groupBy` с
  // `orderBy: { _min: { priceCents } }` — Prisma 5.22 поддерживает это для
  // groupBy. Раньше тянули ВСЕ products в память, sorted в JS, slice'или —
  // на большой категории это было 200–400 ms + 200+ KB payload впустую.
  if (sortRequiresInMemory(sort)) {
    const [total, grouped] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.productVariant.groupBy({
        by: ["productId"],
        where: { product: where },
        _min: { priceCents: true },
        orderBy: { _min: { priceCents: sort === "price_asc" ? "asc" : "desc" } },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
    ]);
    const orderedIds = grouped.map((g) => g.productId);
    if (orderedIds.length === 0) {
      return { items: [], total, page: safePage, pageSize: safeSize, totalPages: 1 };
    }
    const products = await prisma.product.findMany({
      where: { id: { in: orderedIds } },
      select: PRODUCT_CARD_SELECT,
    });
    // findMany не сохраняет порядок `id IN (...)` — пересортируем вручную.
    const byId = new Map(products.map((p) => [p.id, p]));
    const ordered = orderedIds.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    });
    return {
      items: await buildCardsWithStock(ordered),
      total,
      page: safePage,
      pageSize: safeSize,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    };
  }

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: orderByForSort(sort),
      skip: (safePage - 1) * safeSize,
      take: safeSize,
      select: PRODUCT_CARD_SELECT,
    }),
  ]);

  return {
    items: await buildCardsWithStock(products),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

/**
 * Бренды, представленные в категории (включая суб-категории). Используется
 * чтобы показать в `<CategoryFilters>` только релевантные чекбоксы.
 */
export async function getBrandsForCategory(categoryId: string): Promise<BrandCard[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId, isActive: true },
    select: { id: true },
  });
  const categoryIds = [categoryId, ...children.map((c) => c.id)];

  const rows = await prisma.brand.findMany({
    where: {
      products: {
        some: { isActive: true, categoryId: { in: categoryIds } },
      },
    },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, country: true },
  });
  return rows;
}

/**
 * Карточка товара по slug. Возвращает null если товар не найден или
 * помечен isActive=false. Подтягивает варианты с агрегированным stock
 * (сумма `quantity - reserved` по всем филиалам), фото в порядке `order`,
 * категорию + родителя для breadcrumb, бренд.
 */
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const p = await prisma.product.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      descriptionRu: true,
      descriptionUz: true,
      descriptionEn: true,
      ageFromMonths: true,
      ageToMonths: true,
      gender: true,
      attributes: true,
      isActive: true,
      category: {
        select: {
          id: true,
          slug: true,
          nameRu: true,
          nameUz: true,
          nameEn: true,
          parent: {
            select: { id: true, slug: true, nameRu: true, nameUz: true, nameEn: true },
          },
        },
      },
      brand: { select: { slug: true, name: true } },
      variants: {
        orderBy: { priceCents: "asc" },
        select: {
          id: true,
          sku: true,
          color: true,
          size: true,
          priceCents: true,
          oldPriceCents: true,
          weightGrams: true,
          stock: { select: { quantity: true, reserved: true } },
        },
      },
      images: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          url: true,
          alt: true,
          order: true,
          colorTag: true,
          variantId: true,
          sizes: true,
          avifSizes: true,
        },
      },
    },
  });
  if (!p || !p.isActive) return null;

  const variants: ProductVariantDTO[] = p.variants.map((v) => {
    const available = v.stock.reduce((sum, s) => sum + Math.max(0, s.quantity - s.reserved), 0);
    return {
      id: v.id,
      sku: v.sku,
      color: v.color,
      size: v.size,
      priceCents: v.priceCents,
      oldPriceCents: v.oldPriceCents,
      weightGrams: v.weightGrams,
      stockQuantity: available,
    };
  });

  return {
    id: p.id,
    slug: p.slug,
    nameRu: p.nameRu,
    nameUz: p.nameUz,
    nameEn: p.nameEn,
    descriptionRu: p.descriptionRu,
    descriptionUz: p.descriptionUz,
    descriptionEn: p.descriptionEn,
    ageFromMonths: p.ageFromMonths,
    ageToMonths: p.ageToMonths,
    gender: p.gender,
    attributes:
      (p.attributes as Record<string, string | number | boolean | string[]> | null) ?? null,
    category: {
      id: p.category.id,
      slug: p.category.slug,
      nameRu: p.category.nameRu,
      nameUz: p.category.nameUz,
      nameEn: p.category.nameEn,
      parent: p.category.parent,
      // Multi-level breadcrumb: walk через cached tree.
      ancestors: findAncestorChain(await getCategoryTree(), p.category.id),
    },
    brand: p.brand,
    variants,
    images: p.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      order: img.order,
      colorTag: img.colorTag,
      variantId: img.variantId,
      sizes: parseSizesJson(img.sizes),
      avifSizes: parseSizesJson(img.avifSizes),
    })),
  };
}

/** Sanitize Prisma JsonValue → `Record<string, string> | null` для srcset.
 *  Игнорирует non-string значения / not-object формы — безопасно для legacy
 *  данных. */
function parseSizesJson(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ===== Favorites =============================================================

/** Snapshot для клиентской Zustand-store — совпадает с `FavoriteItem` в favorites/store. */
export interface FavoriteItemSnapshot {
  productId: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  imageUrl: string | null;
  minPriceCents: number;
  addedAt: number;
}

/**
 * Избранное юзера с снапшотами для рендера без похода в API.
 * Inactive товары отфильтровываются (юзер их не должен больше видеть).
 */
export async function getFavoritesForUser(userId: string): Promise<FavoriteItemSnapshot[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId, product: { isActive: true } },
    orderBy: { createdAt: "desc" },
    select: {
      productId: true,
      createdAt: true,
      product: { select: PRODUCT_CARD_SELECT },
    },
  });
  return rows.map((r) => {
    // Favorites snapshot не использует stockQuantity → пустой map.
    const card = toProductCardDTO(r.product, EMPTY_STOCK_MAP);
    return {
      productId: r.productId,
      slug: card.slug,
      nameRu: card.nameRu,
      nameUz: card.nameUz,
      nameEn: card.nameEn,
      brandName: card.brandName,
      imageUrl: card.imageUrl,
      minPriceCents: card.minPriceCents,
      addedAt: r.createdAt.getTime(),
    };
  });
}

/** Idempotent upsert в Favorite. Возвращает свежий снапшот для store. */
export async function addFavorite(
  userId: string,
  productId: string,
): Promise<FavoriteItemSnapshot | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { isActive: true, ...PRODUCT_CARD_SELECT },
  });
  if (!product || !product.isActive) return null;

  // @@id([userId, productId]) даёт естественную идемпотентность через upsert.
  const fav = await prisma.favorite.upsert({
    where: { userId_productId: { userId, productId } },
    update: {},
    create: { userId, productId },
    select: { createdAt: true },
  });
  const card = toProductCardDTO(product, EMPTY_STOCK_MAP);
  return {
    productId,
    slug: card.slug,
    nameRu: card.nameRu,
    nameUz: card.nameUz,
    nameEn: card.nameEn,
    brandName: card.brandName,
    imageUrl: card.imageUrl,
    minPriceCents: card.minPriceCents,
    addedAt: fav.createdAt.getTime(),
  };
}

export async function removeFavorite(userId: string, productId: string): Promise<void> {
  await prisma.favorite.delete({ where: { userId_productId: { userId, productId } } }).catch(() => {
    // P2025 "record not found" — idempotent for our purposes.
  });
}

/**
 * Merge guest's productIds с server-side favorites пользователя.
 * Upsert всех id (skip duplicates), возвращает финальный список.
 *
 * Фильтрация: сохраняем только существующие активные продукты — чтобы не
 * плодить «фантомные» Favorite-записи для неактивных/несуществующих id'шек
 * (guest'у могли попасть id'ы деактивированных товаров в `localStorage`).
 */
export async function syncFavorites(
  userId: string,
  guestProductIds: readonly string[],
): Promise<FavoriteItemSnapshot[]> {
  if (guestProductIds.length > 0) {
    const activeIds = await prisma.product.findMany({
      where: { id: { in: [...guestProductIds] }, isActive: true },
      select: { id: true },
    });
    if (activeIds.length > 0) {
      // createMany + skipDuplicates — мгновенная merge-операция без
      // per-id round-trip'ов. FK существует (проверили isActive-where).
      await prisma.favorite.createMany({
        data: activeIds.map((p) => ({ userId, productId: p.id })),
        skipDuplicates: true,
      });
    }
  }
  return getFavoritesForUser(userId);
}

// ===== Sitemap ===============================================================

export interface SitemapCategory {
  slug: string;
  updatedAt: Date;
}

export interface SitemapProduct {
  slug: string;
  updatedAt: Date;
}

/** Все активные категории для sitemap.xml (top + sub). */
export async function getCategoriesForSitemap(): Promise<SitemapCategory[]> {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { slug: true, updatedAt: true },
  });
}

/** Все активные товары для sitemap.xml. */
export async function getProductsForSitemap(): Promise<SitemapProduct[]> {
  return prisma.product.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { slug: true, updatedAt: true },
  });
}

// ===== Search ================================================================

/**
 * Prisma.ProductWhereInput для поиска. `ILIKE '%term%'` (mode: "insensitive")
 * по 3 локальным name-колонкам и имени бренда. Для MVP достаточно substring-
 * match; upgrade на Postgres FTS (tsvector) или Meilisearch — в P8, когда
 * каталог вырастет > 1k товаров.
 */
function searchWhere(term: string): Prisma.ProductWhereInput {
  return {
    isActive: true,
    OR: [
      { nameRu: { contains: term, mode: "insensitive" } },
      { nameUz: { contains: term, mode: "insensitive" } },
      { nameEn: { contains: term, mode: "insensitive" } },
      { brand: { is: { name: { contains: term, mode: "insensitive" } } } },
    ],
  };
}

/** Топ-N матчей для автодополнения. Без count, быстрый путь. */
export async function getSearchSuggestions(q: string, limit = 8): Promise<ProductCardDTO[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const items = await prisma.product.findMany({
    where: searchWhere(term),
    orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: PRODUCT_CARD_SELECT,
  });
  return buildCardsWithStock(items);
}

/** Пагинированные результаты для страницы /search?q=... */
export async function searchProducts(
  q: string,
  { page = 1, pageSize = CATEGORY_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<PaginatedProducts> {
  const term = q.trim();
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));

  if (term.length < 2) {
    return { items: [], total: 0, page: safePage, pageSize: safeSize, totalPages: 0 };
  }

  const where = searchWhere(term);
  const [total, items] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
      skip: (safePage - 1) * safeSize,
      take: safeSize,
      select: PRODUCT_CARD_SELECT,
    }),
  ]);

  return {
    items: await buildCardsWithStock(items),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}
