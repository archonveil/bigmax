/**
 * Pure-helpers для actions на детальной странице заказа (P5-T2):
 *   - `validateRefundEligibility` — может ли пользователь запросить возврат.
 *   - `parseRefundReason` — sanitize/Zod input для тела `POST /refund`.
 *
 * Server-side fetch (Prisma) живёт в `account-order-detail.ts`. Здесь только
 * pure-функции — чтобы юнит-тесты могли проверять граничные случаи без БД.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Refund eligibility
// ---------------------------------------------------------------------------

/**
 * Минимальный срез `Order` для валидации. Реальный fetch будет шире, но для
 * проверки eligibility этих полей достаточно.
 */
export interface RefundEligibilityInput {
  order: {
    status: string;
  };
  /**
   * Payments этого заказа. Возврат применим только к захваченному (captured)
   * платежу. Списки пустые/только-failed/cancelled блокируют запрос.
   */
  payments: ReadonlyArray<{
    id: string;
    status: string;
    amountCents: number;
  }>;
  /**
   * Существующие Refund'ы по этим платежам. Блокируем повторный pending- /
   * completed-запрос. `failed` Refund — НЕ блок (можно перезапросить).
   */
  refunds: ReadonlyArray<{
    paymentId: string;
    status: string;
  }>;
}

export type RefundEligibility =
  | { eligible: true; paymentId: string; amountCents: number }
  | {
      eligible: false;
      reason:
        | "no_captured_payment"
        | "order_cancelled"
        | "refund_already_requested"
        | "refund_already_completed";
    };

/**
 * Решает, может ли пользователь нажать «Запросить возврат» (§5.9 master-prompt).
 *
 * Правила:
 *   - `Order.status === "cancelled"` → блок (заказ уже отменён, возвращать
 *     нечего). Auto-cancellation выключенных платежей произойдёт через
 *     pull-job (P4-T9), Order.status туда не уходит.
 *   - Хотя бы один `Payment.status === "captured"` обязателен.
 *   - Если по этому Payment'у уже есть `Refund.status === "pending"` или
 *     `"completed"` — блок.
 *   - `Refund.status === "failed"` НЕ блокирует — пользователь может
 *     переподать запрос, его проверит admin вручную (P6-T6).
 */
export function validateRefundEligibility(input: RefundEligibilityInput): RefundEligibility {
  if (input.order.status === "cancelled") {
    return { eligible: false, reason: "order_cancelled" };
  }
  const captured = input.payments.find((p) => p.status === "captured");
  if (!captured) {
    return { eligible: false, reason: "no_captured_payment" };
  }
  const refundsForPayment = input.refunds.filter((r) => r.paymentId === captured.id);
  if (refundsForPayment.some((r) => r.status === "completed")) {
    return { eligible: false, reason: "refund_already_completed" };
  }
  if (refundsForPayment.some((r) => r.status === "pending")) {
    return { eligible: false, reason: "refund_already_requested" };
  }
  return { eligible: true, paymentId: captured.id, amountCents: captured.amountCents };
}

// ---------------------------------------------------------------------------
// Refund request body
// ---------------------------------------------------------------------------

/**
 * Тело `POST /api/account/orders/[id]/refund`. Reason — обязательный,
 * 10..1000 символов. Не trim'им до парсинга — `min(10)` сработает на пустую
 * строку из формы и юзер увидит понятный i18n-error.
 */
export const RefundRequestSchema = z.object({
  reason: z.string().trim().min(10, "reason_too_short").max(1000, "reason_too_long"),
});

export type RefundRequest = z.infer<typeof RefundRequestSchema>;
