/**
 * P6-T7: Admin Stock — pure-helpers + Zod-схемы + server-fetch'и для
 * управления остатками по филиалам.
 *
 * Ключевые операции:
 *  - List: per-branch table с filter (q по SKU/product, ?lowStock=true|false).
 *  - Adjust: set / inc / dec на конкретной (variant, branch) паре с reason.
 *  - Upsert: создать новую (variant, branch) пару если её нет.
 *  - Bulk CSV import: `sku,branch_slug,quantity` × N rows, upsert
 *    с одним StockLog на строку (action="import").
 *
 * **Reserved-семантика**: `Stock.reserved` обновляется только бизнес-flow'ами
 * (checkout reserve/release) — admin'ом не трогается. Available = max(0, qty - reserved).
 *
 * **Audit**: каждое изменение `quantity` пишется в `StockLog` с `action`,
 * `oldQty/newQty/delta/reason/adminUserId`. Лог append-only —
 * никогда не удаляется (даже если Stock-row удалён, StockLog остаётся
 * через `onDelete: SetNull` на FK).
 */

import { type Prisma, prisma } from "@bigmax/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADMIN_STOCK_PAGE_SIZE = 50;

/** Совпадает с `LOW_STOCK_THRESHOLD` из P6-T2 dashboard'а — единый порог. */
export const LOW_STOCK_THRESHOLD = 5;

const ADJUST_MODES = ["set", "inc", "dec"] as const;
type AdjustMode = (typeof ADJUST_MODES)[number];

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const STOCK_HEALTHS = ["ok", "low", "out"] as const;
export type StockHealth = (typeof STOCK_HEALTHS)[number];

export const STOCK_SORTS = [
  "available_asc",
  "available_desc",
  "updated_desc",
  "updated_asc",
  "sku_asc",
] as const;
export type StockSort = (typeof STOCK_SORTS)[number];
export const DEFAULT_STOCK_SORT: StockSort = "available_asc";

export interface AdminStockListQuery {
  /** ID филиала (обязателен — список всегда per-branch). null → дефолт = первый
   *  активный филиал, выбирается в page.tsx. */
  branchId: string | null;
  /** Поиск по SKU ИЛИ Product.nameRu (ILIKE %q%). */
  q: string | null;
  /**
   * Чипы-статусы: `ok` (>LOW_STOCK_THRESHOLD), `low` (1..LOW_STOCK_THRESHOLD),
   * `out` (== 0). Пустой массив = без фильтра по статусу. Backwards-compat:
   * `?lowStock=true` (legacy) проецируется в `["low","out"]`.
   */
  statuses: StockHealth[];
  /** Min / max по `available` (после применения статус-фильтра). null = open. */
  availableMin: number | null;
  availableMax: number | null;
  sort: StockSort;
  page: number;
}

function isStockHealth(s: string): s is StockHealth {
  return (STOCK_HEALTHS as readonly string[]).includes(s);
}

function isStockSort(s: string): s is StockSort {
  return (STOCK_SORTS as readonly string[]).includes(s);
}

export function parseAdminStockListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminStockListQuery {
  const raw = searchParams ?? {};
  const branchIdRaw = pickFirst(raw["branchId"]);
  const branchId = branchIdRaw && branchIdRaw.trim() !== "" ? branchIdRaw.trim() : null;

  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 100) : null;

  // statuses: либо массив `?status=ok&status=low`, либо legacy `?lowStock=true`.
  const statusRaw = raw["status"];
  const statusList = Array.isArray(statusRaw) ? statusRaw : statusRaw ? [statusRaw] : [];
  const statuses = Array.from(
    new Set(statusList.filter((s): s is string => typeof s === "string").filter(isStockHealth)),
  );
  if (statuses.length === 0 && pickFirst(raw["lowStock"]) === "true") {
    statuses.push("low", "out");
  }

  const parseNum = (v: string | undefined): number | null => {
    if (v === undefined || v.trim() === "") return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const availableMin = parseNum(pickFirst(raw["minAvailable"]));
  const availableMax = parseNum(pickFirst(raw["maxAvailable"]));

  const sortRaw = pickFirst(raw["sort"]);
  const sort: StockSort = sortRaw && isStockSort(sortRaw) ? sortRaw : DEFAULT_STOCK_SORT;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { branchId, q, statuses, availableMin, availableMax, sort, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Pure adjustments
// ---------------------------------------------------------------------------

/**
 * Применяет mode к oldQty → newQty (clamp на 0). Pure-функция, изолирует
 * арифметику чтобы её можно было тестить без БД.
 */
export function applyAdjust(oldQty: number, mode: AdjustMode, value: number): number {
  switch (mode) {
    case "set":
      return Math.max(0, value);
    case "inc":
      return Math.max(0, oldQty + value);
    case "dec":
      return Math.max(0, oldQty - value);
  }
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

export const StockAdjustSchema = z
  .object({
    mode: z.enum(ADJUST_MODES),
    /** Для `set` — целевое значение; для `inc`/`dec` — дельта. */
    value: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type StockAdjustInput = z.infer<typeof StockAdjustSchema>;

/**
 * Bulk-adjust (P6-T7 follow-up — closes (d)): применяет один и тот же
 * adjust ко всем `Stock` rows в указанном branch, отфильтрованным по
 * SKU-pattern'у (LIKE с `*` wildcard'ом для admin-friendly matching).
 *
 * Лимит 200 stock-rows за raз — каждый требует transaction'а с StockLog,
 * а page-size /admin/stock = 50, так что 200 покрывает 4 страницы — больше
 * редко нужно, и пишет 200 audit-row'ов одной операцией.
 */
export const StockBulkAdjustSchema = z
  .object({
    branchId: z.string().min(1),
    /** SKU-pattern: `NB-*`, `*-PK`, `CH-BD-62-*`. `*` → `%` в SQL ILIKE. */
    skuPattern: z.string().trim().min(1).max(100),
    mode: z.enum(ADJUST_MODES),
    value: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
    /** Cap количества обновлённых записей (защита от accidental все-200). */
    limit: z.number().int().min(1).max(200).optional().default(200),
  })
  .strict();

export type StockBulkAdjustInput = z.infer<typeof StockBulkAdjustSchema>;

/**
 * Конвертит admin-friendly pattern (`NB-*`, `*-PK`) в SQL LIKE pattern
 * (`NB-%`, `%-PK`). Pure-функция для тестируемости.
 */
export function skuPatternToLike(pattern: string): string {
  // Заменяем `*` на `%`. Существующие `%`/`_` экранируем чтобы admin
  // случайно не написал regex-injection через `%` (Postgres LIKE).
  return pattern.replace(/[%_]/g, (c) => `\\${c}`).replace(/\*/g, "%");
}

export const StockUpsertSchema = z
  .object({
    variantId: z.string().min(1),
    branchId: z.string().min(1),
    quantity: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type StockUpsertInput = z.infer<typeof StockUpsertSchema>;

// CSV-импорт: одна строка ↔ один (sku, branch_slug, quantity).
export const StockImportRowSchema = z
  .object({
    sku: z.string().trim().min(1),
    branch_slug: z.string().trim().min(1).optional(),
    branch_id: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().int().min(0).max(1_000_000),
  })
  .refine((v) => v.branch_slug || v.branch_id, {
    message: "branch_required",
  });

export type StockImportRow = z.infer<typeof StockImportRowSchema>;

/**
 * Парсит CSV-текст. Header обязателен и должен включать `sku`, `quantity`
 * и хотя бы один из `branch_slug` / `branch_id`. Строки преобразуются в
 * объекты ключ→значение и валидируются через `StockImportRowSchema` на caller'е.
 *
 * Возвращает либо `{ ok: true, rows[] }`, либо `{ ok: false, reason }`.
 */
export function parseStockCsv(
  text: string,
):
  | { ok: true; rows: Array<Record<string, string>> }
  | { ok: false; reason: "empty" | "missing_columns" | "too_many_rows" } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return { ok: false, reason: "empty" };
  if (lines.length > 1001) return { ok: false, reason: "too_many_rows" };

  const headerLine = lines[0]!;
  const header = headerLine.split(",").map((h) => h.trim());
  const requiredAny = ["sku"];
  const requiredOne = ["branch_slug", "branch_id"];
  const requiredAlways = ["quantity"];
  for (const col of [...requiredAny, ...requiredAlways]) {
    if (!header.includes(col)) return { ok: false, reason: "missing_columns" };
  }
  if (!requiredOne.some((c) => header.includes(c))) {
    return { ok: false, reason: "missing_columns" };
  }

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      const v = cols[idx];
      if (v !== undefined && v !== "") obj[h] = v;
    });
    rows.push(obj);
  }
  return { ok: true, rows };
}

// ---------------------------------------------------------------------------
// Fetches
// ---------------------------------------------------------------------------

export interface AdminBranchOption {
  id: string;
  nameRu: string;
}

/**
 * Stock-row для продуктовой страницы admin'а: per (variant × branch) метрики.
 * Используется `<ProductStockMatrix>` для inline-управления остатками с
 * детальной страницы продукта.
 */
export interface AdminProductStockCell {
  stockId: string;
  variantId: string;
  branchId: string;
  quantity: number;
  reserved: number;
  available: number;
  isLow: boolean;
  isOut: boolean;
  updatedAt: Date;
}

export interface AdminProductStockMatrix {
  branches: AdminBranchOption[];
  /** Map<variantId, Map<branchId, cell>> — пустые ячейки означают,
   *  что Stock-row ещё не создан (новый variant + новый branch). */
  byVariant: Record<string, Record<string, AdminProductStockCell>>;
}

export async function getAdminProductStockMatrix(
  productId: string,
): Promise<AdminProductStockMatrix> {
  const [branches, stocks] = await Promise.all([
    prisma.storeBranch.findMany({
      where: { isActive: true },
      orderBy: { nameRu: "asc" },
      select: { id: true, nameRu: true },
    }),
    prisma.stock.findMany({
      where: { variant: { productId } },
      select: {
        id: true,
        quantity: true,
        reserved: true,
        updatedAt: true,
        variantId: true,
        branchId: true,
      },
    }),
  ]);
  const byVariant: Record<string, Record<string, AdminProductStockCell>> = {};
  for (const s of stocks) {
    const available = Math.max(0, s.quantity - s.reserved);
    const cell: AdminProductStockCell = {
      stockId: s.id,
      variantId: s.variantId,
      branchId: s.branchId,
      quantity: s.quantity,
      reserved: s.reserved,
      available,
      isLow: available > 0 && available <= LOW_STOCK_THRESHOLD,
      isOut: available <= 0,
      updatedAt: s.updatedAt,
    };
    const row = byVariant[s.variantId] ?? {};
    row[s.branchId] = cell;
    byVariant[s.variantId] = row;
  }
  return { branches, byVariant };
}

export async function getAdminStockBranches(): Promise<AdminBranchOption[]> {
  const branches = await prisma.storeBranch.findMany({
    where: { isActive: true },
    orderBy: { nameRu: "asc" },
    select: { id: true, nameRu: true },
  });
  return branches;
}

export interface AdminStockListItem {
  id: string;
  variantId: string;
  branchId: string;
  sku: string;
  productNameRu: string;
  productSlug: string;
  color: string | null;
  size: string | null;
  quantity: number;
  reserved: number;
  available: number;
  isLow: boolean;
  updatedAt: Date;
}

export interface AdminStockListResult {
  items: AdminStockListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminStock(query: AdminStockListQuery): Promise<AdminStockListResult> {
  if (!query.branchId) {
    return { items: [], total: 0, page: 1, pageSize: ADMIN_STOCK_PAGE_SIZE, pageCount: 1 };
  }
  const where: Prisma.StockWhereInput = {
    branchId: query.branchId,
    ...(query.q
      ? {
          OR: [
            { variant: { sku: { contains: query.q, mode: "insensitive" as const } } },
            {
              variant: {
                product: { nameRu: { contains: query.q, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * ADMIN_STOCK_PAGE_SIZE;

  // Status / available-range / sort by `available` требуют sql-выражения
  // qty - reserved (Prisma column-to-column compare не поддерживает).
  // Делаем post-filter + sort после fetch'а. Tame через cap take=1000.
  const needsPostFilter =
    query.statuses.length > 0 ||
    query.availableMin !== null ||
    query.availableMax !== null ||
    query.sort === "available_asc" ||
    query.sort === "available_desc";

  // Prisma orderBy для server-side сортировки, когда post-filter не нужен.
  const orderBy: Prisma.StockOrderByWithRelationInput[] = (() => {
    switch (query.sort) {
      case "updated_desc":
        return [{ updatedAt: "desc" }];
      case "updated_asc":
        return [{ updatedAt: "asc" }];
      case "sku_asc":
        return [{ variant: { sku: "asc" } }];
      // available_* и default → сортируем по quantity asc на этапе DB,
      // финальный порядок выставится в post-sort'е (если нужен post-filter).
      case "available_asc":
      case "available_desc":
      default:
        return [{ quantity: "asc" }, { variant: { sku: "asc" } }];
    }
  })();

  const [stocksRaw, totalRaw] = await Promise.all([
    prisma.stock.findMany({
      where,
      orderBy,
      skip: needsPostFilter ? 0 : skip,
      take: needsPostFilter ? 1000 : ADMIN_STOCK_PAGE_SIZE,
      select: {
        id: true,
        quantity: true,
        reserved: true,
        updatedAt: true,
        variantId: true,
        branchId: true,
        variant: {
          select: {
            sku: true,
            color: true,
            size: true,
            product: { select: { nameRu: true, slug: true } },
          },
        },
      },
    }),
    prisma.stock.count({ where }),
  ]);

  const enriched = stocksRaw.map((s) => {
    const available = Math.max(0, s.quantity - s.reserved);
    return {
      id: s.id,
      variantId: s.variantId,
      branchId: s.branchId,
      sku: s.variant.sku,
      productNameRu: s.variant.product.nameRu,
      productSlug: s.variant.product.slug,
      color: s.variant.color,
      size: s.variant.size,
      quantity: s.quantity,
      reserved: s.reserved,
      available,
      isLow: available > 0 && available <= LOW_STOCK_THRESHOLD,
      updatedAt: s.updatedAt,
    };
  });

  if (needsPostFilter) {
    let filtered = enriched;
    if (query.statuses.length > 0) {
      const wanted = new Set(query.statuses);
      filtered = filtered.filter((e) => {
        const h: StockHealth = e.available === 0 ? "out" : e.isLow ? "low" : "ok";
        return wanted.has(h);
      });
    }
    if (query.availableMin !== null) {
      const min = query.availableMin;
      filtered = filtered.filter((e) => e.available >= min);
    }
    if (query.availableMax !== null) {
      const max = query.availableMax;
      filtered = filtered.filter((e) => e.available <= max);
    }
    if (query.sort === "available_desc") {
      filtered.sort((a, b) => b.available - a.available || a.sku.localeCompare(b.sku));
    } else if (query.sort === "available_asc") {
      filtered.sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));
    }
    const total = filtered.length;
    const items = filtered.slice(skip, skip + ADMIN_STOCK_PAGE_SIZE);
    return {
      items,
      total,
      page: query.page,
      pageSize: ADMIN_STOCK_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / ADMIN_STOCK_PAGE_SIZE)),
    };
  }

  return {
    items: enriched,
    total: totalRaw,
    page: query.page,
    pageSize: ADMIN_STOCK_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(totalRaw / ADMIN_STOCK_PAGE_SIZE)),
  };
}

export const STOCK_HISTORY_PAGE_SIZE = 50;

export interface AdminStockHistoryItem {
  id: string;
  action: string;
  oldQty: number;
  newQty: number;
  delta: number;
  oldReserved: number;
  newReserved: number;
  reservedDelta: number;
  reason: string | null;
  adminEmail: string | null;
  createdAt: Date;
}

export interface AdminStockHistoryResult {
  items: AdminStockHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Compact страница истории для product-detail page'а: 10 свежих записей. */
export const PRODUCT_STOCK_HISTORY_PAGE_SIZE = 10;

export interface AdminProductStockHistoryItem extends AdminStockHistoryItem {
  variantId: string;
  variantSku: string;
  variantColor: string | null;
  variantSize: string | null;
  branchId: string;
  branchNameRu: string;
}

export interface AdminProductStockHistoryResult {
  items: AdminProductStockHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * История stock-операций по ВСЕМ вариантам одного продукта × всем филиалам.
 * Используется на странице товара — admin видит, кто и когда менял остатки
 * этого товара, не переходя на per-Stock-row history page.
 */
export async function getAdminProductStockHistory(
  productId: string,
  page = 1,
): Promise<AdminProductStockHistoryResult> {
  const where: Prisma.StockLogWhereInput = {
    variant: { productId },
  };
  const skip = (page - 1) * PRODUCT_STOCK_HISTORY_PAGE_SIZE;

  const [logs, total] = await Promise.all([
    prisma.stockLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PRODUCT_STOCK_HISTORY_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        oldQty: true,
        newQty: true,
        delta: true,
        oldReserved: true,
        newReserved: true,
        reservedDelta: true,
        reason: true,
        createdAt: true,
        variantId: true,
        branchId: true,
        adminUser: { select: { email: true } },
        variant: { select: { sku: true, color: true, size: true } },
        branch: { select: { nameRu: true } },
      },
    }),
    prisma.stockLog.count({ where }),
  ]);

  return {
    items: logs.map((l) => ({
      id: l.id,
      action: l.action,
      oldQty: l.oldQty,
      newQty: l.newQty,
      delta: l.delta,
      oldReserved: l.oldReserved,
      newReserved: l.newReserved,
      reservedDelta: l.reservedDelta,
      reason: l.reason,
      adminEmail: l.adminUser?.email ?? null,
      createdAt: l.createdAt,
      variantId: l.variantId,
      variantSku: l.variant.sku,
      variantColor: l.variant.color,
      variantSize: l.variant.size,
      branchId: l.branchId,
      branchNameRu: l.branch.nameRu,
    })),
    total,
    page,
    pageSize: PRODUCT_STOCK_HISTORY_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_STOCK_HISTORY_PAGE_SIZE)),
  };
}

/**
 * Полная история StockLog для (variant, branch) пары — pagination.
 * Используется в `/admin/stock/[id]/history`. Лог append-only — totals
 * считаются один раз и кэшируются на уровне БД-индекса
 * `(variant_id, branch_id)`.
 */
export async function getAdminStockHistory(
  stockId: string,
  page: number,
): Promise<AdminStockHistoryResult> {
  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    select: { variantId: true, branchId: true },
  });
  if (!stock) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: STOCK_HISTORY_PAGE_SIZE,
      pageCount: 1,
    };
  }
  const where = { variantId: stock.variantId, branchId: stock.branchId };
  const skip = (page - 1) * STOCK_HISTORY_PAGE_SIZE;

  const [logs, total] = await Promise.all([
    prisma.stockLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: STOCK_HISTORY_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        oldQty: true,
        newQty: true,
        delta: true,
        oldReserved: true,
        newReserved: true,
        reservedDelta: true,
        reason: true,
        createdAt: true,
        adminUser: { select: { email: true } },
      },
    }),
    prisma.stockLog.count({ where }),
  ]);

  return {
    items: logs.map((l) => ({
      id: l.id,
      action: l.action,
      oldQty: l.oldQty,
      newQty: l.newQty,
      delta: l.delta,
      oldReserved: l.oldReserved,
      newReserved: l.newReserved,
      reservedDelta: l.reservedDelta,
      reason: l.reason,
      adminEmail: l.adminUser?.email ?? null,
      createdAt: l.createdAt,
    })),
    total,
    page,
    pageSize: STOCK_HISTORY_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / STOCK_HISTORY_PAGE_SIZE)),
  };
}

export interface AdminStockEntry extends AdminStockListItem {
  branchNameRu: string;
  logs: Array<{
    id: string;
    action: string;
    oldQty: number;
    newQty: number;
    delta: number;
    reason: string | null;
    adminEmail: string | null;
    createdAt: Date;
  }>;
}

export async function getAdminStockEntry(id: string): Promise<AdminStockEntry | null> {
  const stock = await prisma.stock.findUnique({
    where: { id },
    select: {
      id: true,
      quantity: true,
      reserved: true,
      updatedAt: true,
      variantId: true,
      branchId: true,
      variant: {
        select: {
          sku: true,
          color: true,
          size: true,
          product: { select: { nameRu: true, slug: true } },
        },
      },
      branch: { select: { nameRu: true } },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          action: true,
          oldQty: true,
          newQty: true,
          delta: true,
          reason: true,
          createdAt: true,
          adminUser: { select: { email: true } },
        },
      },
    },
  });
  if (!stock) return null;

  const available = Math.max(0, stock.quantity - stock.reserved);
  return {
    id: stock.id,
    variantId: stock.variantId,
    branchId: stock.branchId,
    sku: stock.variant.sku,
    productNameRu: stock.variant.product.nameRu,
    productSlug: stock.variant.product.slug,
    color: stock.variant.color,
    size: stock.variant.size,
    quantity: stock.quantity,
    reserved: stock.reserved,
    available,
    isLow: available <= LOW_STOCK_THRESHOLD,
    updatedAt: stock.updatedAt,
    branchNameRu: stock.branch.nameRu,
    logs: stock.logs.map((l) => ({
      id: l.id,
      action: l.action,
      oldQty: l.oldQty,
      newQty: l.newQty,
      delta: l.delta,
      reason: l.reason,
      adminEmail: l.adminUser?.email ?? null,
      createdAt: l.createdAt,
    })),
  };
}
