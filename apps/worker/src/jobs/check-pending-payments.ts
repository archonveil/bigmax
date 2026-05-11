/**
 * `checkPendingPaymentsJob` (P4-T9 master-prompt §5.8).
 *
 * Раз в минуту проверяет Uniteller-платежи в `pending`-состоянии старше 2 мин:
 *   - Запрашивает `/results/` через `fetchPaymentStatus`.
 *   - Если `Authorized` / `Paid` → обновляет `Payment.status='captured'` +
 *     `Order.status='confirmed'` (если ещё не был такой) + `capturedAt`.
 *   - Если `Canceled` / `NotAuthorized` → `Payment.status='failed'`.
 *   - Если `Waiting` или нет ответа → пропуск, проверим в следующий запуск.
 *   - Если `Payment.createdAt` старше `Lifetime + 5 мин` (по-умолчанию 35) и
 *     всё ещё `pending` — локальная отмена `Payment.status='cancelled'` +
 *     `Order.status='cancelled'` (удалённый Uniteller-cancel — для refunds в
 *     P6-T6, не здесь).
 *
 * Архитектура: pure-функция `decidePaymentAction(payment, snapshot, now,
 * lifetimeMin)` возвращает enum-action; orchestrator `checkPendingPaymentsJob`
 * принимает все зависимости через DI (prisma + fetchStatus + now), что делает
 * её полностью тестируемой без Redis/Prisma/HTTP.
 */

// `ExtendedExtendedPrismaClient` — это тип `@bigmax/db.prisma` (singleton с
// `$extends.result` для BigInt → number coercion). Раньше тут использовался
// raw `ExtendedPrismaClient`, но он `missing $on/$use` относительно extended-типа
// (несовместимая drift при passing extended-инстанса в job). После
// P-money-to-bigint все consumers extended-клиента должны типизироваться
// именно через `ExtendedExtendedPrismaClient`.
import type { ExtendedPrismaClient } from "@bigmax/db";
import {
  mapUnitellerStatus,
  scrubPaymentPayload,
  UNITELLER_DEFAULT_LIFETIME_MIN,
  type FetchPaymentStatusResult,
} from "@bigmax/payments/uniteller";

import { reportError } from "../observability";

// ---------------------------------------------------------------------------
// Pure decision function
// ---------------------------------------------------------------------------

export type PaymentAction =
  | { kind: "capture"; billnumber?: string; responseCode?: string }
  | { kind: "fail"; billnumber?: string; responseCode?: string }
  | { kind: "cancel_local"; reason: "lifetime_expired" }
  | { kind: "noop" };

export interface DecidePaymentActionInput {
  /** Срез из `Payment.findMany` — нужны только `createdAt` + `status`. */
  payment: { createdAt: Date; status: string };
  /** Результат `fetchPaymentStatus`. `null` если запрос вообще не делался. */
  snapshot: FetchPaymentStatusResult | null;
  /** Ссылка на «сейчас» — DI для тестов. */
  now: Date;
  /** Lifetime ссылки оплаты в минутах (по-умолчанию 30 — `UNITELLER_DEFAULT_LIFETIME_MIN`). */
  lifetimeMin?: number;
  /** Сколько минут после `Lifetime` ждать перед локальной отменой. Default: 5. */
  graceMin?: number;
}

export function decidePaymentAction(input: DecidePaymentActionInput): PaymentAction {
  const lifetimeMin = input.lifetimeMin ?? UNITELLER_DEFAULT_LIFETIME_MIN;
  const graceMin = input.graceMin ?? 5;

  // 1) Если есть свежий snapshot со статусом — приоритет ему.
  if (input.snapshot && input.snapshot.kind === "ok") {
    const item = input.snapshot.items[0];
    if (item) {
      const internal = mapUnitellerStatus(item.Status);
      if (internal === "captured") {
        return {
          kind: "capture",
          ...(item.Billnumber ? { billnumber: item.Billnumber } : {}),
          ...(item.ApprovalCode ? { responseCode: item.ApprovalCode } : {}),
        };
      }
      if (internal === "failed") {
        return {
          kind: "fail",
          ...(item.Billnumber ? { billnumber: item.Billnumber } : {}),
          ...(item.ApprovalCode ? { responseCode: item.ApprovalCode } : {}),
        };
      }
      // Waiting → внутренний 'pending' → noop, проверим позже.
    }
    // items пуст — Uniteller не знает про этот Order_ID; ждём дальше.
  }

  // 2) Snapshot отсутствует или Waiting/empty — проверяем lifetime.
  const ageMs = input.now.getTime() - input.payment.createdAt.getTime();
  const expireAfterMs = (lifetimeMin + graceMin) * 60_000;
  if (ageMs >= expireAfterMs) {
    return { kind: "cancel_local", reason: "lifetime_expired" };
  }

  return { kind: "noop" };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface CheckPendingPaymentsDeps {
  prisma: ExtendedPrismaClient;
  /** DI'шка над `fetchPaymentStatus` — закрывает env (shopId/auth) на вызовы. */
  fetchStatus: (orderId: string) => Promise<FetchPaymentStatusResult>;
  /** DI now — упрощает тесты с фиксированным временем. */
  now: () => Date;
  lifetimeMin?: number;
  graceMin?: number;
  /** Минимальный возраст pending-платежа для проверки. Default: 2 мин. */
  minAgeMin?: number;
}

export interface JobResult {
  scanned: number;
  captured: number;
  failed: number;
  cancelled: number;
  errors: number;
}

export async function checkPendingPaymentsJob(deps: CheckPendingPaymentsDeps): Promise<JobResult> {
  const minAgeMin = deps.minAgeMin ?? 2;
  const now = deps.now();
  const cutoff = new Date(now.getTime() - minAgeMin * 60_000);

  const payments = await deps.prisma.payment.findMany({
    where: {
      provider: "uniteller",
      status: "pending",
      createdAt: { lt: cutoff },
      unitellerOrderIdp: { not: null },
    },
    select: {
      id: true,
      orderId: true,
      status: true,
      createdAt: true,
      unitellerOrderIdp: true,
    },
  });

  const result: JobResult = {
    scanned: payments.length,
    captured: 0,
    failed: 0,
    cancelled: 0,
    errors: 0,
  };

  for (const p of payments) {
    if (p.unitellerOrderIdp === null) continue; // contract-level guard
    let snapshot: FetchPaymentStatusResult | null = null;
    try {
      snapshot = await deps.fetchStatus(p.unitellerOrderIdp);
    } catch (err) {
      result.errors += 1;
      reportError(err, {
        scope: "worker.checkPendingPayments.fetchStatus",
        extra: { paymentId: p.id, orderIdp: p.unitellerOrderIdp },
      });
      await safeLog(deps.prisma, p.id, "pull_status_error", {
        message: err instanceof Error ? err.message : "unknown",
      });
      // snapshot остаётся null — decision может всё равно решить cancel_local.
    }

    const decision = decidePaymentAction({
      payment: p,
      snapshot,
      now,
      ...(deps.lifetimeMin !== undefined ? { lifetimeMin: deps.lifetimeMin } : {}),
      ...(deps.graceMin !== undefined ? { graceMin: deps.graceMin } : {}),
    });

    try {
      switch (decision.kind) {
        case "capture":
          await applyCapture(deps.prisma, p, decision, now);
          result.captured += 1;
          break;
        case "fail":
          await applyFail(deps.prisma, p, decision);
          result.failed += 1;
          break;
        case "cancel_local":
          await applyCancelLocal(deps.prisma, p);
          result.cancelled += 1;
          break;
        case "noop":
          break;
      }
    } catch (err) {
      result.errors += 1;
      reportError(err, {
        scope: "worker.checkPendingPayments.apply",
        extra: { paymentId: p.id, decision: decision.kind },
      });
      await safeLog(deps.prisma, p.id, "pull_apply_error", {
        decision: decision.kind,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Прикладные мутации (вызываются orchestrator'ом)
// ---------------------------------------------------------------------------

async function applyCapture(
  prisma: ExtendedPrismaClient,
  payment: { id: string; orderId: string; status: string },
  decision: Extract<PaymentAction, { kind: "capture" }>,
  now: Date,
): Promise<void> {
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "captured",
        ...(decision.billnumber ? { unitellerBillnumber: decision.billnumber } : {}),
        ...(decision.responseCode ? { unitellerResponseCode: decision.responseCode } : {}),
        ...(payment.status !== "captured" ? { capturedAt: now } : {}),
      },
    }),
    prisma.order.update({
      where: { id: payment.orderId },
      data: { status: "confirmed" },
    }),
    prisma.paymentLog.create({
      data: {
        paymentId: payment.id,
        action: "pull_capture",
        statusCode: 200,
      },
    }),
  ]);
}

async function applyFail(
  prisma: ExtendedPrismaClient,
  payment: { id: string },
  decision: Extract<PaymentAction, { kind: "fail" }>,
): Promise<void> {
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "failed",
        ...(decision.billnumber ? { unitellerBillnumber: decision.billnumber } : {}),
        ...(decision.responseCode ? { unitellerResponseCode: decision.responseCode } : {}),
      },
    }),
    prisma.paymentLog.create({
      data: {
        paymentId: payment.id,
        action: "pull_fail",
        statusCode: 200,
      },
    }),
  ]);
}

async function applyCancelLocal(
  prisma: ExtendedPrismaClient,
  payment: { id: string; orderId: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "cancelled" },
    }),
    prisma.order.update({
      where: { id: payment.orderId },
      data: { status: "cancelled" },
    }),
    prisma.paymentLog.create({
      data: {
        paymentId: payment.id,
        action: "pull_cancel_local",
        statusCode: 200,
        errorMessage: "lifetime_expired",
      },
    }),
  ]);
}

async function safeLog(
  prisma: ExtendedPrismaClient,
  paymentId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.paymentLog.create({
      data: {
        paymentId,
        action,
        // §5.12: scrub секретов / PAN на случай если когда-нибудь сюда
        // попадёт raw Uniteller-payload или error.context с CardNumber.
        request: scrubPaymentPayload(payload) as never,
        statusCode: 500,
      },
    });
  } catch {
    // Best-effort — не валим job.
  }
}
