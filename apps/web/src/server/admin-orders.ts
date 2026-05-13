/**
 * Admin Orders — серверный fetch + state-machine для смены статусов
 * (P6-T5 §F13/§5.5).
 *
 * **State-machine** (`canTransitionOrderStatus`) — pure-функция, проверяет
 * допустимы ли переходы между статусами. Согласовано с
 * `validateRefundEligibility` / `validateCancelEligibility` из P5:
 *
 *   pending → confirmed | cancelled
 *   confirmed → packing | cancelled
 *   packing → shipped | cancelled
 *   shipped → delivered (cancel ↔ admin only с возвратом средств)
 *   delivered → refunded
 *   cancelled / refunded → terminal
 *
 * Терминальные статусы (`cancelled`, `refunded`) не имеют исходящих
 * переходов в admin-flow — расковыряют только через DB.
 */

import { prisma, type OrderStatus, type Prisma } from "@bigmax/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packing", "cancelled"],
  packing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(from: OrderStatus): ReadonlyArray<OrderStatus> {
  return TRANSITIONS[from];
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const satisfies ReadonlyArray<OrderStatus>;

export const OrderStatusChangeSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    /** Опциональный комментарий admin'а — пишется в PaymentLog для audit. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type OrderStatusChangeInput = z.infer<typeof OrderStatusChangeSchema>;

/**
 * Bulk-смена статуса (P6-T5 follow-up, закрывает open question (c)).
 *
 * Up to 200 ids; каждый id валидируется через state-machine отдельно.
 * `skipped[]` накапливает причины (`not_found` / `illegal_transition` /
 * `status_unchanged`) — total response: `{updated, skipped[]}`.
 */
export const OrderBulkStatusSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    status: z.enum(ORDER_STATUSES),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type OrderBulkStatusInput = z.infer<typeof OrderBulkStatusSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const ADMIN_ORDERS_PAGE_SIZE = 20;

export interface AdminOrderListQuery {
  /** Поиск по `Order.number` (точное совпадение startsWith) ИЛИ `User.email`. */
  q: string | null;
  status: OrderStatus | null;
  /** ISO date `YYYY-MM-DD` начала диапазона (включительно, UTC midnight). */
  from: Date | null;
  /** ISO date `YYYY-MM-DD` конца диапазона (включительно, end-of-day UTC). */
  to: Date | null;
  page: number;
}

/** Парсит `YYYY-MM-DD` в `Date` с фиксированным временем (UTC). Невалидный → null. */
function parseDateBoundary(input: string | undefined, kind: "start" | "end"): Date | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const time = kind === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const d = new Date(`${input}${time}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function parseAdminOrderListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminOrderListQuery {
  const raw = searchParams ?? {};
  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 100) : null;

  const statusRaw = pickFirst(raw["status"]);
  const status =
    statusRaw && (ORDER_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as OrderStatus)
      : null;

  let from = parseDateBoundary(pickFirst(raw["from"]), "start");
  let to = parseDateBoundary(pickFirst(raw["to"]), "end");
  // Если from > to — игнорируем оба, чтобы не дать админу пустой результат
  // от опечатки в querystring.
  if (from && to && from.getTime() > to.getTime()) {
    from = null;
    to = null;
  }

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { q, status, from, to, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Fetches
// ---------------------------------------------------------------------------

export interface AdminOrderListItem {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  createdAt: Date;
  itemsCount: number;
  paymentProvider: string | null;
  paymentStatus: string | null;
}

export interface AdminOrderListResult {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminOrders(query: AdminOrderListQuery): Promise<AdminOrderListResult> {
  const createdAtFilter: Prisma.DateTimeFilter | undefined =
    query.from || query.to
      ? {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        }
      : undefined;
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    ...(query.q
      ? {
          OR: [
            { number: { contains: query.q, mode: "insensitive" as const } },
            { user: { email: { contains: query.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * ADMIN_ORDERS_PAGE_SIZE;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ADMIN_ORDERS_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
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
    items: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalCents: o.totalCents,
      currency: o.currency,
      customerEmail: o.user.email,
      customerName: o.user.name,
      createdAt: o.createdAt,
      itemsCount: o._count.items,
      paymentProvider: o.payments[0]?.provider ?? null,
      paymentStatus: o.payments[0]?.status ?? null,
    })),
    total,
    page: query.page,
    pageSize: ADMIN_ORDERS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_ORDERS_PAGE_SIZE)),
  };
}

export interface AdminOrderItemSnapshot {
  sku?: string;
  color?: string | null;
  size?: string | null;
  product?: { slug?: string; nameRu?: string };
}

export interface AdminOrderItem {
  id: string;
  variantId: string | null;
  quantity: number;
  priceCents: number;
  snapshot: AdminOrderItemSnapshot;
}

export interface AdminOrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  subtotalCents: number;
  deliveryCostCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  deliveryMethod: "courier" | "pickup";
  comment: string | null;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
  };
  items: AdminOrderItem[];
  payments: Array<{
    id: string;
    provider: string;
    status: string;
    amountCents: number;
    unitellerBillnumber: string | null;
    unitellerCardMask: string | null;
    capturedAt: Date | null;
  }>;
  refunds: Array<{
    id: string;
    amountCents: number;
    reason: string;
    status: string;
    createdAt: Date;
  }>;
  address: {
    region: string;
    city: string;
    district: string | null;
    street: string | null;
    house: string | null;
    apartment: string | null;
  } | null;
  branch: {
    id: string;
    nameRu: string;
    addressRu: string;
  } | null;
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      subtotalCents: true,
      deliveryCostCents: true,
      discountCents: true,
      totalCents: true,
      currency: true,
      deliveryMethod: true,
      comment: true,
      locale: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: { id: true, email: true, name: true, phone: true },
      },
      address: {
        select: {
          region: true,
          city: true,
          district: true,
          street: true,
          house: true,
          apartment: true,
        },
      },
      branch: { select: { id: true, nameRu: true, addressRu: true } },
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          priceCents: true,
          productSnapshot: true,
        },
        orderBy: { id: "asc" },
      },
      payments: {
        select: {
          id: true,
          provider: true,
          status: true,
          amountCents: true,
          unitellerBillnumber: true,
          unitellerCardMask: true,
          capturedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) return null;

  const paymentIds = order.payments.map((p) => p.id);
  const refunds =
    paymentIds.length > 0
      ? await prisma.refund.findMany({
          where: { paymentId: { in: paymentIds } },
          select: {
            id: true,
            amountCents: true,
            reason: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  return {
    ...order,
    deliveryMethod: order.deliveryMethod as "courier" | "pickup",
    customer: order.user,
    items: order.items.map((it) => ({
      id: it.id,
      variantId: it.variantId,
      quantity: it.quantity,
      priceCents: it.priceCents,
      snapshot: (it.productSnapshot ?? {}) as AdminOrderItemSnapshot,
    })),
    refunds,
  };
}
