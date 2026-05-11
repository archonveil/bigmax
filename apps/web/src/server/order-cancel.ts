/**
 * Pure-helpers для отмены заказа клиентом (P5-T4 master-prompt §8).
 *
 * Cancel ≠ refund:
 *   - **Cancel** (P5-T4) — отмена *до* отправки. Если Payment captured, мы
 *     вызываем Uniteller `/cancel/` и void'им авторизацию (deprecated если
 *     уже settled). Refund-row при этом НЕ создаётся.
 *   - **Refund** (P5-T2) — возврат уже settled-средств. Создаётся
 *     `Refund(status=pending)` для admin-модерации.
 *
 * Eligibility-правила (§5.9 master-prompt):
 *   - `Order.status` должен быть `pending` ИЛИ `confirmed`. Состояния
 *     `packing/shipped/delivered` означают что заказ уже комплектуется или
 *     уехал — отмену делает только admin (P6-T6).
 *   - `cancelled`/`refunded` уже терминальные — нечего отменять.
 *   - Если есть pending Refund на captured Payment — блок: пользователь
 *     уже инициировал refund-flow, это конфликт с cancel-flow.
 */

import { z } from "zod";

export interface CancelEligibilityInput {
  order: {
    status: string;
  };
  payments: ReadonlyArray<{
    id: string;
    provider: string;
    status: string;
    /** RRN — нужен для POST /cancel/ если captured. */
    unitellerBillnumber: string | null;
    unitellerOrderIdp: string | null;
  }>;
  refunds: ReadonlyArray<{
    paymentId: string;
    status: string;
  }>;
}

export type CancelEligibility =
  | {
      eligible: true;
      /**
       * Captured Uniteller-платёж, по которому надо звать `/cancel/`. `null`
       * если COD ИЛИ Uniteller pending/failed (тогда просто local-flip).
       */
      capturedPayment: {
        id: string;
        billnumber: string | null;
        orderIdp: string | null;
      } | null;
    }
  | {
      eligible: false;
      reason: "order_too_late" | "order_already_cancelled" | "refund_in_progress";
    };

const FINAL_STATUSES = new Set(["cancelled", "refunded"]);
const TOO_LATE_STATUSES = new Set(["packing", "shipped", "delivered"]);
const CANCELABLE_STATUSES = new Set(["pending", "confirmed"]);

/**
 * Решает можно ли клиенту нажать «Отменить заказ».
 *
 * Возвращает `capturedPayment` среди eligible-веток, чтобы caller мог решить:
 *   - `null` → просто `prisma.$transaction` с update'ами Order/Payment.
 *   - не-null → сначала позвать Uniteller `/cancel/`, потом DB-update.
 */
export function validateCancelEligibility(input: CancelEligibilityInput): CancelEligibility {
  if (FINAL_STATUSES.has(input.order.status)) {
    return { eligible: false, reason: "order_already_cancelled" };
  }
  if (TOO_LATE_STATUSES.has(input.order.status)) {
    return { eligible: false, reason: "order_too_late" };
  }
  if (!CANCELABLE_STATUSES.has(input.order.status)) {
    // Неизвестный статус — паранойя на случай миграции, не разрешаем.
    return { eligible: false, reason: "order_too_late" };
  }

  const captured = input.payments.find(
    (p) => p.provider === "uniteller" && p.status === "captured",
  );

  // Если уже есть pending Refund по captured payment'у — пользователь уже
  // запустил refund-flow, нельзя дублировать через cancel. Дождётся admin'а.
  if (captured) {
    const hasPendingRefund = input.refunds.some(
      (r) => r.paymentId === captured.id && r.status === "pending",
    );
    if (hasPendingRefund) {
      return { eligible: false, reason: "refund_in_progress" };
    }
    return {
      eligible: true,
      capturedPayment: {
        id: captured.id,
        billnumber: captured.unitellerBillnumber,
        orderIdp: captured.unitellerOrderIdp,
      },
    };
  }

  return { eligible: true, capturedPayment: null };
}

/**
 * Тело `POST /api/account/orders/[id]/cancel`. Reason — опциональный
 * (короткий — может быть просто «передумал»). Если указан — 1..500 символов.
 */
export const CancelRequestSchema = z
  .object({
    reason: z.string().trim().max(500, "reason_too_long").optional(),
  })
  .strict();

export type CancelRequest = z.infer<typeof CancelRequestSchema>;
