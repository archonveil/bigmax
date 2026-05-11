/**
 * `POST /api/account/orders/[id]/cancel` (P5-T4 master-prompt §8 / §5.9).
 *
 * Клиентская отмена заказа до этапа «упаковки». Owner-only — на чужой
 * Order возвращает 404. Eligibility через `validateCancelEligibility`:
 *   - `pending` / `confirmed` → ОК.
 *   - `packing` / `shipped` / `delivered` → 409 `order_too_late`.
 *   - `cancelled` / `refunded` → 409 `order_already_cancelled`.
 *   - При уже-pending refund'е → 409 `refund_in_progress`.
 *
 * Если Payment.captured (Uniteller) — синхронно зовём
 * `cancelUnitellerPayment` (POST /cancel/ через Basic-auth + Billnumber).
 * Локальный flip Order/Payment делаем ТОЛЬКО после успешного ответа
 * Uniteller'а — иначе вернём 502 и юзер сможет ретрайнуть. На COD
 * провайдере /cancel/-вызов пропускается.
 */

import { prisma } from "@bigmax/db";
import { uniteller } from "@bigmax/payments";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getOrderDetail } from "@/server/account-order-detail";
import { reverseLoyaltyForOrder } from "@/server/loyalty";
import { reportError } from "@/server/observability";
import { CancelRequestSchema, validateCancelEligibility } from "@/server/order-cancel";
import { releaseOrderStock } from "@/server/order-stock-movement";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // --- Body (опциональная reason) -------------------------------------------
  let body: unknown = {};
  // Тело может отсутствовать — это валидно. Read errors глушим в {}.
  try {
    const text = await req.text();
    if (text.trim() !== "") body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = CancelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const reason = parsed.data.reason ?? null;

  // --- Owner-проверка через getOrderDetail ----------------------------------
  const order = await getOrderDetail(session.user.id, ctx.params.id);
  if (!order) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  // --- Eligibility ----------------------------------------------------------
  const eligibility = validateCancelEligibility({
    order: { status: order.status },
    payments: order.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      unitellerBillnumber: p.unitellerBillnumber ?? null,
      // `unitellerOrderIdp` не приходит из getOrderDetail — добавим из Order.number
      unitellerOrderIdp: order.number,
    })),
    refunds: order.refunds,
  });
  if (!eligibility.eligible) {
    return NextResponse.json({ ok: false, reason: eligibility.reason }, { status: 409 });
  }

  // --- Опциональный Uniteller /cancel/ --------------------------------------
  if (eligibility.capturedPayment) {
    const shopId = process.env["UNITELLER_SHOP_ID"] ?? "";
    const authLogin = process.env["UNITELLER_AUTH_LOGIN"] ?? "";
    const authPassword = process.env["UNITELLER_AUTH_PASSWORD"] ?? "";
    if (shopId === "" || authLogin === "" || authPassword === "") {
      // misconfig — не пытаемся отменить captured-платёж без auth.
      reportError(new Error("UNITELLER_AUTH_* missing — cancel skipped"), {
        scope: "web.account.cancel",
        extra: { paymentId: eligibility.capturedPayment.id },
      });
      return NextResponse.json({ ok: false, reason: "provider_misconfigured" }, { status: 503 });
    }

    const cancelResult = await uniteller.cancelUnitellerPayment({
      orderId: eligibility.capturedPayment.orderIdp ?? order.number,
      shopId,
      authLogin,
      authPassword,
      billnumber: eligibility.capturedPayment.billnumber,
    });

    if (cancelResult.kind !== "ok") {
      // PaymentLog + Sentry, отдаём 502 — юзер увидит inline-сообщение
      // и сможет повторить попытку. Локальный state не трогаем.
      await writePaymentLog({
        paymentId: eligibility.capturedPayment.id,
        action: "cancel_failed",
        request: {
          orderId: order.number,
          billnumber: eligibility.capturedPayment.billnumber,
        },
        response: {
          kind: cancelResult.kind,
          ...("message" in cancelResult ? { message: cancelResult.message } : {}),
        },
        statusCode: 502,
        errorMessage: "message" in cancelResult ? cancelResult.message : cancelResult.kind,
      });
      reportError(new Error(`uniteller cancel failed: ${cancelResult.kind}`), {
        scope: "web.account.cancel",
        extra: {
          paymentId: eligibility.capturedPayment.id,
          orderId: order.number,
          providerResult: cancelResult,
        },
      });
      return NextResponse.json(
        { ok: false, reason: "provider_error", message: cancelResult.kind },
        { status: 502 },
      );
    }
  }

  // --- Atomic flip Order + Payments + loyalty reversal + audit -------------
  // P7-T2 sub-task A: используем callback-form `$transaction(async (tx) => …)`
  // вместо array-form, чтобы `reverseLoyaltyForOrder` мог делать собственные
  // findMany/update внутри той же атомарной транзакции. Idempotent: повторный
  // cancel (retry после network-failure) даст `alreadyReversed=true`.
  const reversal = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: "cancelled" },
    });
    for (const p of order.payments) {
      if (p.status === "captured" || p.status === "pending") {
        await tx.payment.update({
          where: { id: p.id },
          data: { status: "cancelled" },
        });
      }
    }
    return reverseLoyaltyForOrder(tx, order.id);
  });
  // Audit reversal — best-effort, не валим cancel если PaymentLog не запишется.
  if (
    order.payments[0] &&
    !reversal.alreadyReversed &&
    (reversal.refunded > 0 || reversal.clawedBack > 0)
  ) {
    await writePaymentLog({
      paymentId: order.payments[0].id,
      action: "loyalty.reversed",
      request: { orderId: order.id, by: "user", reason },
      response: { refunded: reversal.refunded, clawedBack: reversal.clawedBack },
      statusCode: 200,
    });
  }

  // P6-T7 follow-up: release reserved stock — best-effort, decrement
  // Stock.reserved для каждой позиции + StockLog audit. Не валим cancel
  // если что-то пошло не так (например, нет Stock-row).
  await releaseOrderStock({ orderId: order.id, adminUserId: null });

  // PaymentLog audit (best-effort — не падаем если не запишется).
  if (order.payments[0]) {
    await writePaymentLog({
      paymentId: order.payments[0].id,
      action: "cancel_by_user",
      request: { reason, capturedCancelled: eligibility.capturedPayment !== null },
      statusCode: 200,
    });
  }

  return NextResponse.json(
    { ok: true, orderId: order.id, status: "cancelled" },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
