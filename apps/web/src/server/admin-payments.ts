/**
 * P6-T6: Admin Payments — server-fetch + Zod-схемы для управления
 * платежами и возвратами.
 *
 * Поддерживаемые операции (см. master-prompt §5.9, §8 P6-T6):
 *  - List + filter (status/provider/q-by-orderNumber/email)
 *  - Detail с timeline'ами PaymentLog (audit) + WebhookEvent (Uniteller
 *    callbacks) + Refund history
 *  - Refund (полный или частичный): валидируем сумму ≤ оставшийся
 *    refundable_remaining (subtotal − ∑ completed_refunds)
 *  - Recheck (manual pull-status): re-вызов `/results/` Uniteller для
 *    зависших pending платежей; COD пропускает с 400
 *
 * Не throw'ит на partial-failure'ы — admin видит точную причину через
 * discriminated `reason` поле в response'е.
 */

import { type Prisma, prisma } from "@bigmax/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADMIN_PAYMENTS_PAGE_SIZE = 20;

const PAYMENT_STATUSES = [
  "pending",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const PAYMENT_PROVIDERS = ["uniteller", "cod"] as const;
type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export interface AdminPaymentListQuery {
  /** Поиск по `Order.number` ИЛИ `User.email` (ILIKE %q%). */
  q: string | null;
  status: PaymentStatus | null;
  provider: PaymentProvider | null;
  page: number;
}

export function parseAdminPaymentListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminPaymentListQuery {
  const raw = searchParams ?? {};
  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 100) : null;

  const statusRaw = pickFirst(raw["status"]);
  const status =
    statusRaw && (PAYMENT_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as PaymentStatus)
      : null;

  const providerRaw = pickFirst(raw["provider"]);
  const provider =
    providerRaw && (PAYMENT_PROVIDERS as readonly string[]).includes(providerRaw)
      ? (providerRaw as PaymentProvider)
      : null;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { q, status, provider, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Refund Zod
// ---------------------------------------------------------------------------

export const RefundCreateSchema = z
  .object({
    amountCents: z.number().int().positive().max(1_000_000_000),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type RefundCreateInput = z.infer<typeof RefundCreateSchema>;

/**
 * Bulk-refund (P6-T6 follow-up — closes open question (d)).
 *
 * Принимает до 50 paymentId'шек + одну общую `reason` + один из режимов:
 *  - `mode: "full"` — возвращает весь оставшийся `refundableRemaining`
 *    у каждого платежа.
 *  - `mode: "fixed"` + `amountCents` — возвращает фиксированную сумму у
 *    каждого; платежи с remaining < amountCents попадают в skipped.
 *
 * Лимит 50 (vs. 200 для bulk status change) — refund'ы делают
 * outbound-вызовы в Uniteller, и каждый имеет 30s timeout; 50 × 30s =
 * 25 минут worst-case. Больше — отдельный slot с очередями.
 */
export const RefundBulkSchema = z
  .object({
    paymentIds: z.array(z.string().min(1)).min(1).max(50),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .and(
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("full") }),
      z.object({
        mode: z.literal("fixed"),
        amountCents: z.number().int().positive().max(1_000_000_000),
      }),
    ]),
  );

export type RefundBulkInput = z.infer<typeof RefundBulkSchema>;

/**
 * Pure-функция: вычисляет, сколько ещё можно вернуть. `payment.amountCents`
 * минус сумма всех `completed` или `pending` рефандов (pending тоже резервируем
 * чтобы admin не наделал параллельных рефандов на сумму больше captured).
 */
export function computeRefundableRemaining(
  amountCents: number,
  refunds: ReadonlyArray<{ amountCents: number; status: string }>,
): number {
  const reserved = refunds
    .filter((r) => r.status === "completed" || r.status === "pending")
    .reduce((sum, r) => sum + r.amountCents, 0);
  return Math.max(0, amountCents - reserved);
}

/**
 * Можно ли инициировать refund для данного платежа? Pure-проверка — статус
 * `captured` или `partially_refunded` обязателен; `pending`/`failed`/
 * `cancelled`/`refunded` — refund невозможен.
 */
export function canRefundPayment(status: string): boolean {
  return status === "captured" || status === "partially_refunded";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface AdminPaymentListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string | null;
  customerName: string | null;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  unitellerCardMask: string | null;
  createdAt: Date;
  capturedAt: Date | null;
}

export interface AdminPaymentListResult {
  items: AdminPaymentListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminPayments(
  query: AdminPaymentListQuery,
): Promise<AdminPaymentListResult> {
  const where: Prisma.PaymentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.q
      ? {
          OR: [
            { order: { number: { contains: query.q, mode: "insensitive" as const } } },
            {
              order: {
                user: { email: { contains: query.q, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * ADMIN_PAYMENTS_PAGE_SIZE;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ADMIN_PAYMENTS_PAGE_SIZE,
      select: {
        id: true,
        provider: true,
        status: true,
        amountCents: true,
        currency: true,
        unitellerCardMask: true,
        createdAt: true,
        capturedAt: true,
        order: {
          select: {
            id: true,
            number: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    items: payments.map((p) => ({
      id: p.id,
      orderId: p.order.id,
      orderNumber: p.order.number,
      customerEmail: p.order.user.email,
      customerName: p.order.user.name,
      provider: p.provider,
      status: p.status,
      amountCents: p.amountCents,
      currency: p.currency,
      unitellerCardMask: p.unitellerCardMask,
      createdAt: p.createdAt,
      capturedAt: p.capturedAt,
    })),
    total,
    page: query.page,
    pageSize: ADMIN_PAYMENTS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_PAYMENTS_PAGE_SIZE)),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface AdminPaymentDetail {
  id: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string | null;
  customerName: string | null;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  unitellerOrderIdp: string | null;
  unitellerBillnumber: string | null;
  unitellerResponseCode: string | null;
  unitellerCardMask: string | null;
  createdAt: Date;
  capturedAt: Date | null;
  updatedAt: Date;
  refunds: Array<{
    id: string;
    amountCents: number;
    reason: string;
    status: string;
    unitellerRefundId: string | null;
    createdAt: Date;
  }>;
  paymentLogs: Array<{
    id: string;
    action: string;
    statusCode: number | null;
    errorMessage: string | null;
    request: unknown;
    response: unknown;
    createdAt: Date;
  }>;
  webhookEvents: Array<{
    id: string;
    eventType: string;
    externalId: string | null;
    processed: boolean;
    receivedAt: Date;
  }>;
  refundableRemaining: number;
  canRefund: boolean;
}

export async function getAdminPayment(id: string): Promise<AdminPaymentDetail | null> {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      status: true,
      amountCents: true,
      currency: true,
      unitellerOrderIdp: true,
      unitellerBillnumber: true,
      unitellerResponseCode: true,
      unitellerCardMask: true,
      createdAt: true,
      capturedAt: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          number: true,
          user: { select: { email: true, name: true } },
        },
      },
      refunds: {
        select: {
          id: true,
          amountCents: true,
          reason: true,
          status: true,
          unitellerRefundId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      logs: {
        select: {
          id: true,
          action: true,
          statusCode: true,
          errorMessage: true,
          request: true,
          response: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!payment) return null;

  // WebhookEvent'ы привязаны к Order_IDP (= Order.number), не к Payment.id —
  // это контракт идемпотентности из P4-T6. Подтягиваем по `externalId`.
  const webhookEvents = payment.unitellerOrderIdp
    ? await prisma.webhookEvent.findMany({
        where: { provider: "uniteller", externalId: payment.unitellerOrderIdp },
        select: {
          id: true,
          eventType: true,
          externalId: true,
          processed: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: "desc" },
        take: 20,
      })
    : [];

  const refundableRemaining = computeRefundableRemaining(payment.amountCents, payment.refunds);

  return {
    id: payment.id,
    orderId: payment.order.id,
    orderNumber: payment.order.number,
    customerEmail: payment.order.user.email,
    customerName: payment.order.user.name,
    provider: payment.provider,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    unitellerOrderIdp: payment.unitellerOrderIdp,
    unitellerBillnumber: payment.unitellerBillnumber,
    unitellerResponseCode: payment.unitellerResponseCode,
    unitellerCardMask: payment.unitellerCardMask,
    createdAt: payment.createdAt,
    capturedAt: payment.capturedAt,
    updatedAt: payment.updatedAt,
    refunds: payment.refunds,
    paymentLogs: payment.logs,
    webhookEvents,
    refundableRemaining,
    canRefund: canRefundPayment(payment.status) && refundableRemaining > 0,
  };
}
