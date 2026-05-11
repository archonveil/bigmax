/**
 * `POST /api/admin/payments/[id]/recheck` (P6-T6, master-prompt §5.8, §8).
 *
 * Manual pull-status: admin вручную дёргает Uniteller `/results/` для
 * зависшего pending-платежа (вместо ожидания cron-job'а
 * `checkPendingPaymentsJob`). Нужно когда:
 *  - Webhook не пришёл (network glitch на стороне Uniteller).
 *  - Юзер вернулся на success-страницу, но `Payment.status` ещё `pending`.
 *  - Admin хочет force-refresh перед refund'ом.
 *
 * Поток:
 *  1. requireAdminSession.
 *  2. findUnique payment (404).
 *  3. COD → 400 `cod_recheck_unsupported` (у COD нет провайдера для pull).
 *  4. Нет `unitellerOrderIdp` → 400 `no_uniteller_idp`.
 *  5. fetchPaymentStatus → mapUnitellerStatus → flip `Payment.status` если
 *     отличается от текущего; для `captured` ставим `capturedAt = now`,
 *     `Order.status = 'confirmed'` если ещё не был.
 *  6. PaymentLog audit с raw response.
 *
 * Response:
 *  - 200 `{ok, status, changed: bool, providerStatus}`
 *  - 400 invalid_state (cod_recheck_unsupported / no_uniteller_idp)
 *  - 401/404 от requireAdminSession
 *  - 404 payment_not_found
 *  - 502 provider_error
 *  - 503 provider_misconfigured
 */

import { prisma } from "@bigmax/db";
import { uniteller } from "@bigmax/payments";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { reportError } from "@/server/observability";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function POST(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const payment = await prisma.payment.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      provider: true,
      status: true,
      amountCents: true,
      unitellerOrderIdp: true,
      unitellerBillnumber: true,
      orderId: true,
      order: { select: { id: true, status: true, number: true } },
    },
  });
  if (!payment) {
    return NextResponse.json({ ok: false, reason: "payment_not_found" }, { status: 404 });
  }
  if (payment.provider === "cod") {
    return NextResponse.json({ ok: false, reason: "cod_recheck_unsupported" }, { status: 400 });
  }
  if (!payment.unitellerOrderIdp) {
    return NextResponse.json({ ok: false, reason: "no_uniteller_idp" }, { status: 400 });
  }

  const shopId = process.env["UNITELLER_SHOP_ID"] ?? "";
  const authLogin = process.env["UNITELLER_AUTH_LOGIN"] ?? "";
  const authPassword = process.env["UNITELLER_AUTH_PASSWORD"] ?? "";
  if (shopId === "" || authLogin === "" || authPassword === "") {
    reportError(new Error("UNITELLER_AUTH_* missing — recheck skipped"), {
      scope: "web.admin.recheck",
      extra: { paymentId: payment.id },
    });
    return NextResponse.json({ ok: false, reason: "provider_misconfigured" }, { status: 503 });
  }

  const result = await uniteller.fetchPaymentStatus({
    orderId: payment.unitellerOrderIdp,
    shopId,
    authLogin,
    authPassword,
  });

  if (result.kind !== "ok") {
    await writePaymentLog({
      paymentId: payment.id,
      action: "recheck_failed",
      request: { orderId: payment.unitellerOrderIdp, adminId: auth.userId },
      response: {
        kind: result.kind,
        ...("message" in result ? { message: result.message } : {}),
      },
      statusCode: 502,
      errorMessage: "message" in result ? result.message : result.kind,
    });
    return NextResponse.json(
      { ok: false, reason: "provider_error", message: result.kind },
      { status: 502 },
    );
  }

  const item = result.items[0];
  const providerStatus = item?.Status ?? null;
  const internal = providerStatus ? uniteller.mapUnitellerStatus(providerStatus) : null;

  await writePaymentLog({
    paymentId: payment.id,
    action: "recheck_ok",
    request: { orderId: payment.unitellerOrderIdp, adminId: auth.userId },
    response: { providerStatus, internal, billnumber: item?.Billnumber ?? null },
    statusCode: 200,
  });

  // Если статус не изменился — просто возвращаем current.
  if (!internal || internal === payment.status) {
    return NextResponse.json(
      { ok: true, status: payment.status, changed: false, providerStatus },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  }

  // Flip statuses в transaction'е.
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: internal,
        ...(item?.Billnumber ? { unitellerBillnumber: item.Billnumber } : {}),
        ...(internal === "captured" && payment.status !== "captured" ? { capturedAt: now } : {}),
      },
      select: { id: true },
    });
    if (internal === "captured" && payment.order.status === "pending") {
      await tx.order.update({
        where: { id: payment.order.id },
        data: { status: "confirmed" },
        select: { id: true },
      });
    }
  });

  return NextResponse.json(
    { ok: true, status: internal, changed: true, providerStatus },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
