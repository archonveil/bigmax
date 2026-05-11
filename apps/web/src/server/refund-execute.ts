/**
 * P6-T6 follow-up: исполнитель refund'а — единая точка для single-refund'а
 * (`/api/admin/payments/[id]/refund`) и bulk-refund'а (`/api/admin/payments/bulk-refund`).
 *
 * Не throw'ит — discriminated `Result` для caller'а; route-handler решает
 * какой HTTP-status вернуть. Caller отвечает за `requireAdminSession` и
 * Zod-валидацию входа.
 */

import { type Prisma, prisma } from "@bigmax/db";
import { uniteller } from "@bigmax/payments";

import { canRefundPayment, computeRefundableRemaining } from "./admin-payments";
import { reportError } from "./observability";
import { writePaymentLog } from "./payment-log";

export type RefundExecuteResult =
  | {
      kind: "ok";
      refundId: string;
      unitellerRefundId: string | null;
      paymentStatus: "refunded" | "partially_refunded";
      refundableRemaining: number;
      amountCents: number;
    }
  | { kind: "payment_not_found" }
  | { kind: "not_refundable"; paymentStatus: string }
  | { kind: "amount_exceeds_remaining"; remaining: number }
  | { kind: "provider_misconfigured" }
  | { kind: "provider_error"; message: string };

interface ExecuteInput {
  paymentId: string;
  /** Если undefined → full remaining (используется в bulk `mode: "full"`). */
  amountCents?: number;
  reason: string;
  adminUserId: string;
  adminEmail: string | null;
}

function centsToDecimal(cents: number): string {
  const major = Math.floor(cents / 100);
  const minor = cents % 100;
  return `${major}.${String(minor).padStart(2, "0")}`;
}

export async function executeRefund(input: ExecuteInput): Promise<RefundExecuteResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      provider: true,
      status: true,
      amountCents: true,
      currency: true,
      unitellerOrderIdp: true,
      unitellerBillnumber: true,
      order: { select: { id: true, number: true } },
      refunds: { select: { amountCents: true, status: true } },
    },
  });
  if (!payment) return { kind: "payment_not_found" };

  if (!canRefundPayment(payment.status)) {
    return { kind: "not_refundable", paymentStatus: payment.status };
  }

  const remaining = computeRefundableRemaining(payment.amountCents, payment.refunds);
  const amountCents = input.amountCents ?? remaining;
  if (amountCents > remaining) {
    return { kind: "amount_exceeds_remaining", remaining };
  }

  const attemptIndex = payment.refunds.length + 1;
  const billOrIdp =
    payment.unitellerBillnumber ?? payment.unitellerOrderIdp ?? payment.order.number;
  const syntheticRefundId =
    payment.provider === "uniteller" ? `${billOrIdp}-r${attemptIndex}` : null;

  // Uniteller cancel/refund (COD пропускает).
  if (payment.provider === "uniteller") {
    const shopId = process.env["UNITELLER_SHOP_ID"] ?? "";
    const authLogin = process.env["UNITELLER_AUTH_LOGIN"] ?? "";
    const authPassword = process.env["UNITELLER_AUTH_PASSWORD"] ?? "";
    if (shopId === "" || authLogin === "" || authPassword === "") {
      reportError(new Error("UNITELLER_AUTH_* missing — refund skipped"), {
        scope: "web.admin.refund",
        extra: { paymentId: payment.id },
      });
      return { kind: "provider_misconfigured" };
    }

    const isFull = amountCents === remaining && payment.refunds.length === 0;
    const cancelResult = await uniteller.cancelUnitellerPayment({
      orderId: payment.unitellerOrderIdp ?? payment.order.number,
      shopId,
      authLogin,
      authPassword,
      billnumber: payment.unitellerBillnumber,
      ...(isFull ? {} : { subtotal: centsToDecimal(amountCents) }),
    });

    if (cancelResult.kind !== "ok") {
      const errorMessage = "message" in cancelResult ? cancelResult.message : cancelResult.kind;
      const failedRefund = await prisma.refund
        .create({
          data: {
            paymentId: payment.id,
            amountCents,
            reason: input.reason,
            initiatedByUserId: input.adminUserId,
            status: "failed",
          } satisfies Prisma.RefundUncheckedCreateInput,
          select: { id: true },
        })
        .catch(() => null);
      await writePaymentLog({
        paymentId: payment.id,
        action: "refund_failed",
        request: {
          orderId: payment.order.number,
          billnumber: payment.unitellerBillnumber,
          amountCents,
          reason: input.reason,
          adminId: input.adminUserId,
          attemptIndex,
        },
        response: {
          kind: cancelResult.kind,
          message: errorMessage,
          refundRowId: failedRefund?.id ?? null,
        },
        statusCode: 502,
        errorMessage,
      });
      reportError(new Error(`uniteller refund failed: ${cancelResult.kind}`), {
        scope: "web.admin.refund",
        extra: {
          paymentId: payment.id,
          orderId: payment.order.number,
          providerResult: cancelResult,
        },
      });
      return { kind: "provider_error", message: cancelResult.kind };
    }
  }

  const newRemaining = remaining - amountCents;
  const newPaymentStatus: "refunded" | "partially_refunded" =
    newRemaining === 0 ? "refunded" : "partially_refunded";

  const refund = await prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({
      data: {
        paymentId: payment.id,
        amountCents,
        reason: input.reason,
        initiatedByUserId: input.adminUserId,
        status: "completed",
        ...(syntheticRefundId ? { unitellerRefundId: syntheticRefundId } : {}),
      } satisfies Prisma.RefundUncheckedCreateInput,
      select: { id: true, unitellerRefundId: true },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: newPaymentStatus },
      select: { id: true },
    });
    return r;
  });

  await writePaymentLog({
    paymentId: payment.id,
    action: "refund_completed",
    request: {
      orderId: payment.order.number,
      amountCents,
      reason: input.reason,
      adminId: input.adminUserId,
      adminEmail: input.adminEmail,
      provider: payment.provider,
      attemptIndex,
    },
    response: {
      refundId: refund.id,
      unitellerRefundId: refund.unitellerRefundId,
      paymentStatus: newPaymentStatus,
      remaining: newRemaining,
    },
    statusCode: 200,
  });

  return {
    kind: "ok",
    refundId: refund.id,
    unitellerRefundId: refund.unitellerRefundId,
    paymentStatus: newPaymentStatus,
    refundableRemaining: newRemaining,
    amountCents,
  };
}
