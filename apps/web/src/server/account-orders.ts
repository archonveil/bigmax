/**
 * `/account/orders` — server-side fetch + querystring парсинг (P5-T1).
 *
 * Pure-функции парсинга/sanitize в отдельном модуле — чтобы юнит-тесты
 * могли проверять граничные случаи (?status=garbage&page=-5) без поднятия
 * Next.js. Сам fetch (`getUserOrders`) делает запросы к Prisma и тоже здесь
 * (для централизованного `select`-формата — page рендерит, тест ассёртит).
 */

import { prisma, type OrderStatus, type Prisma } from "@bigmax/db";

/**
 * Все возможные значения `Order.status` из Prisma enum. Должно совпадать с
 * `enum OrderStatus` в schema.prisma — синхронизируется руками при изменении
 * схемы (если когда-нибудь добавим, например, `awaiting_pickup`).
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const satisfies ReadonlyArray<OrderStatus>;

/** Размер страницы списка — по UX нет пагинации со сложными скачками, пусть будет 10. */
export const ORDERS_PAGE_SIZE = 10;

export interface OrderListQuery {
  /** Фильтр по `Order.status`. `null` = «все статусы». */
  status: OrderStatus | null;
  /** 1-based номер страницы. Дефолт: 1. */
  page: number;
}

/**
 * Парсит querystring `/account/orders?status=...&page=...` в типизированный
 * `OrderListQuery`. Сценарии:
 *   - `?status=foo` (не из enum'а) → `status: null` (treat as «все»).
 *   - `?status=` или отсутствует → `null`.
 *   - `?page=2` → `page: 2`. `?page=abc` или `?page=-5` или `?page=0` → 1.
 *   - `?page=99999` — никаких ограничений в парсере; ограничит сама БД (count).
 *
 * Не throw'ит — query-param'ы могут прийти любые, мы их нормализуем.
 */
export function parseOrderListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): OrderListQuery {
  const raw = searchParams ?? {};
  const statusRaw = pickFirst(raw["status"]);
  const status =
    statusRaw && (ORDER_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as OrderStatus)
      : null;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { status, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Prisma fetch
// ---------------------------------------------------------------------------

export type OrderListItem = {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  createdAt: Date;
  itemsCount: number;
  paymentProvider: string | null;
  paymentStatus: string | null;
};

export interface OrderListResult {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Загружает страницу заказов пользователя, опционально фильтруя по статусу.
 * Сортировка: `createdAt DESC` (свежие сверху). Возвращает summary-поля
 * (без `OrderItem[]`-снапшотов) — детали open'ятся в `/account/orders/:id`
 * (P5-T2).
 */
export async function getUserOrders(
  userId: string,
  query: OrderListQuery,
): Promise<OrderListResult> {
  const where: Prisma.OrderWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };
  const skip = (query.page - 1) * ORDERS_PAGE_SIZE;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ORDERS_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        _count: { select: { items: true } },
        payments: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { provider: true, status: true },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalCents: o.totalCents,
      currency: o.currency,
      createdAt: o.createdAt,
      itemsCount: o._count.items,
      paymentProvider: o.payments[0]?.provider ?? null,
      paymentStatus: o.payments[0]?.status ?? null,
    })),
    total,
    page: query.page,
    pageSize: ORDERS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)),
  };
}
