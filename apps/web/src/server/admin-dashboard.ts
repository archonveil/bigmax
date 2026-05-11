/**
 * Admin dashboard — серверный fetch агрегатов и pure-helpers (P6-T2 §8).
 *
 * Pure-функции (`dashboardRanges`, `LOW_STOCK_THRESHOLD`) лежат отдельно
 * от Prisma-запросов, чтобы юнит-тесты могли проверять граничные кейсы
 * (UTC-rollover, leap day, DST в host-timezone). Сами агрегаты
 * `getDashboardStats` бьют в БД и проверяются e2e через seeded заказы.
 */

import { prisma, type OrderStatus } from "@bigmax/db";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Order-статусы, при которых выручка считается «учтённой». Pending/cancelled/
 * refunded не дают revenue. Master-prompt §F8: confirmed после оплаты.
 */
export const REVENUE_STATUSES = [
  "confirmed",
  "packing",
  "shipped",
  "delivered",
] as const satisfies ReadonlyArray<OrderStatus>;

/** Порог «мало на остатке». Можно вынести в env позже (P8-T6). */
export const LOW_STOCK_THRESHOLD = 5;

/** Сколько pending-Uniteller-платежей старше N сек попадают в дашборд-очередь. */
export const PENDING_UNITELLER_MIN_AGE_SEC = 120;

export interface DashboardRanges {
  /** UTC-полночь сегодняшнего дня (start of "today"). */
  todayStart: Date;
  /** Полночь 7 дней назад. */
  weekStart: Date;
  /** Полночь 30 дней назад. */
  monthStart: Date;
}

/**
 * Считает три временных границы для дашборда: today / week / month. Всё в
 * UTC — мы работаем в +05:00 (UZ), но для аналитики «ровно сутки = ровно
 * 86400 сек» удобнее, чем «локальный день». При сдвиге на UZ отображение
 * можно будет накатить в P8.
 */
export function dashboardRanges(now: Date): DashboardRanges {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return {
    todayStart,
    weekStart: subDaysUtc(todayStart, 7),
    monthStart: subDaysUtc(todayStart, 30),
  };
}

function subDaysUtc(base: Date, days: number): Date {
  // Создание новой Date через UTC ms — устойчиво к DST в локальной TZ.
  return new Date(base.getTime() - days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface OrdersByStatus {
  status: OrderStatus;
  count: number;
}

export interface RevenueWindow {
  /** Сумма totalCents по orders в `REVENUE_STATUSES`. */
  totalCents: number;
  /** Кол-во соответствующих orders. */
  count: number;
}

export interface TopProductRow {
  productSlug: string;
  productName: string;
  totalQuantity: number;
  totalRevenueCents: number;
}

export interface LowStockRow {
  variantId: string;
  branchId: string;
  branchName: string;
  productSlug: string;
  productName: string;
  sku: string;
  variantLabel: string | null;
  quantity: number;
  reserved: number;
}

export interface PendingUnitellerRow {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amountCents: number;
  createdAt: Date;
  /** Возраст платежа в секундах — пригодится для подсветки stuck'ов. */
  ageSec: number;
}

export interface DashboardStats {
  ordersByStatus: OrdersByStatus[];
  /** Общее число заказов (все статусы) — для KPI-карточки. */
  ordersTotal: number;
  revenue: {
    today: RevenueWindow;
    week: RevenueWindow;
    month: RevenueWindow;
  };
  topProducts: TopProductRow[];
  lowStock: LowStockRow[];
  pendingUniteller: PendingUnitellerRow[];
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Prisma fetch
// ---------------------------------------------------------------------------

/**
 * Загружает все секции дашборда параллельно через `Promise.all` — каждая
 * подзадача независима, общий wall-time ≈ max(query). DI'шка по `now()` —
 * для тестов с фиксированным временем.
 */
export async function getDashboardStats(now: Date = new Date()): Promise<DashboardStats> {
  const ranges = dashboardRanges(now);
  const pendingCutoff = new Date(now.getTime() - PENDING_UNITELLER_MIN_AGE_SEC * 1000);

  const [
    ordersGrouped,
    revenueToday,
    revenueWeek,
    revenueMonth,
    topProductsRaw,
    lowStockRaw,
    pendingPaymentsRaw,
  ] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    aggregateRevenue(ranges.todayStart),
    aggregateRevenue(ranges.weekStart),
    aggregateRevenue(ranges.monthStart),
    // P1-15: top-products точная revenue. Раньше это было `_sum: { quantity, priceCents }`
    // и `qty × _sum.priceCents` — что O(N²)-некорректно (умножает суммарную qty на
    // сумму единичных цен). Сейчас одним $queryRaw считаем точное `sum(qty × price_cents)`
    // на SQL-уровне. Бонусом: после миграции priceCents → BigInt прежний `qty * price`
    // ломался runtime-ошибкой "Cannot mix BigInt and other types".
    // P1-15: top-products точная revenue.
    //
    // ВАЖНО: использовали `$queryRawUnsafe` потому что `Prisma.raw(...)` внутри
    // `$queryRaw` tagged template НЕ инлайнится — Prisma превращает его в
    // одиночный $1-параметр (PG потом видит `IN ($1)` и ругается на text=jsonb).
    // Корректный путь: $queryRawUnsafe со собранной вручную SQL-строкой и
    // позиционными параметрами — REVENUE_STATUSES это статический whitelist
    // (не user-input), поэтому SQL-injection не угроза.
    prisma.$queryRawUnsafe<Array<{ variant_id: string; qty: bigint; revenue: bigint }>>(
      `
      SELECT
        oi.variant_id,
        SUM(oi.quantity)::bigint                       AS qty,
        SUM(oi.quantity::bigint * oi.price_cents)::bigint AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN (${REVENUE_STATUSES.map((s) => `'${s}'::"OrderStatus"`).join(", ")})
        AND o.created_at >= $1::timestamp(3)
      GROUP BY oi.variant_id
      ORDER BY qty DESC
      LIMIT 5
      `,
      ranges.monthStart,
    ),
    prisma.stock.findMany({
      where: { quantity: { lt: LOW_STOCK_THRESHOLD } },
      orderBy: { quantity: "asc" },
      take: 10,
      select: {
        variantId: true,
        branchId: true,
        quantity: true,
        reserved: true,
        branch: { select: { nameRu: true } },
        variant: {
          select: {
            sku: true,
            color: true,
            size: true,
            product: { select: { slug: true, nameRu: true } },
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        provider: "uniteller",
        status: "pending",
        createdAt: { lt: pendingCutoff },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        id: true,
        orderId: true,
        amountCents: true,
        createdAt: true,
        order: { select: { number: true } },
      },
    }),
  ]);

  const ordersByStatus: OrdersByStatus[] = ordersGrouped.map((row) => ({
    status: row.status,
    count: row._count._all,
  }));
  const ordersTotal = ordersByStatus.reduce((sum, r) => sum + r.count, 0);

  // Top-products: после raw-агрегата выше — отдельный запрос за product/slug
  // по variantId (5 строк max, без N+1).
  const topVariantIds = topProductsRaw.map((r) => r.variant_id);
  const variantInfo =
    topVariantIds.length > 0
      ? await prisma.productVariant.findMany({
          where: { id: { in: topVariantIds } },
          select: {
            id: true,
            product: { select: { slug: true, nameRu: true } },
          },
        })
      : [];
  const variantById = new Map(variantInfo.map((v) => [v.id, v]));
  const topProducts: TopProductRow[] = topProductsRaw
    .map((row) => {
      const v = variantById.get(row.variant_id);
      if (!v) return null;
      // qty / revenue приходят bigint из PG; коэрсим в number — обе величины
      // безопасно влезают в Number.MAX_SAFE_INTEGER (qty <<2^31, revenue <<2^53).
      return {
        productSlug: v.product.slug,
        productName: v.product.nameRu,
        totalQuantity: Number(row.qty),
        totalRevenueCents: Number(row.revenue),
      } satisfies TopProductRow;
    })
    .filter((r): r is TopProductRow => r !== null);

  const lowStock: LowStockRow[] = lowStockRaw.map((s) => ({
    variantId: s.variantId,
    branchId: s.branchId,
    branchName: s.branch.nameRu,
    productSlug: s.variant.product.slug,
    productName: s.variant.product.nameRu,
    sku: s.variant.sku,
    variantLabel: [s.variant.color, s.variant.size].filter(Boolean).join(" / ") || null,
    quantity: s.quantity,
    reserved: s.reserved,
  }));

  const pendingUniteller: PendingUnitellerRow[] = pendingPaymentsRaw.map((p) => ({
    paymentId: p.id,
    orderId: p.orderId,
    orderNumber: p.order.number,
    amountCents: p.amountCents,
    createdAt: p.createdAt,
    ageSec: Math.floor((now.getTime() - p.createdAt.getTime()) / 1000),
  }));

  return {
    ordersByStatus,
    ordersTotal,
    revenue: { today: revenueToday, week: revenueWeek, month: revenueMonth },
    topProducts,
    lowStock,
    pendingUniteller,
    generatedAt: now,
  };
}

async function aggregateRevenue(since: Date): Promise<RevenueWindow> {
  const agg = await prisma.order.aggregate({
    where: {
      status: { in: [...REVENUE_STATUSES] },
      createdAt: { gte: since },
    },
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  // Prisma `_sum` на BigInt-колонке возвращает bigint в runtime'е (несмотря на
  // что extended-client типизирует это как number). Без явного Number() поле
  // утекает дальше по цепочке `formatCurrencyUzs → centsToSum → cents/100` и
  // падает с "Cannot mix BigInt and other types".
  return {
    totalCents: agg._sum.totalCents === null ? 0 : Number(agg._sum.totalCents),
    count: agg._count._all,
  };
}
