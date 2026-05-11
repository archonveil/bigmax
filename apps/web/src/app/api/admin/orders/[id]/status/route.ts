/**
 * `POST /api/admin/orders/[id]/status` (P6-T5).
 *
 * Меняет `Order.status` после валидации перехода через
 * `canTransitionOrderStatus` (state-machine). Каждое изменение
 * пишется в `PaymentLog` (`order.status_change`) для audit'а — даже
 * если у заказа нет payments (paymentId=null).
 *
 * Response:
 *  - 200 `{ ok, id, status }` при успешной смене
 *  - 400 при invalid_body (Zod) или illegal_transition
 *  - 401 / 404 от `requireAdminSession`
 *  - 404 если заказ не найден
 *  - 409 если status_unchanged (already in target state)
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { OrderStatusChangeSchema, canTransitionOrderStatus } from "@/server/admin-orders";
import { incrementPromoUsage } from "@/server/admin-promo";
import {
  awardLoyaltyPoints,
  getLoyaltyEarnPercent,
  reverseLoyaltyForOrder,
} from "@/server/loyalty";
import { commitOrderShipment, releaseOrderStock } from "@/server/order-stock-movement";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = OrderStatusChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { status: nextStatus, reason } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      status: true,
      // P7-T1 sub-task A: при shipped → delivered нужно знать (a) есть ли
      // pending COD-платёж к захвату, (b) какой промокод применили — чтобы
      // в одной TX бампнуть Promo.usedCount. Для Uniteller-flow это делает
      // webhook на первой капчуре; для COD момента «деньги в руке» раньше
      // не было — теперь это переход в delivered.
      // P7-T2: + `userId` + `totalCents` для атомарного начисления баллов
      // лояльности (`awardLoyaltyPoints`).
      userId: true,
      totalCents: true,
      promoCode: true,
      payments: { select: { id: true, provider: true, status: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  if (order.status === nextStatus) {
    return NextResponse.json({ ok: false, reason: "status_unchanged" }, { status: 409 });
  }

  if (!canTransitionOrderStatus(order.status, nextStatus)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "illegal_transition",
        from: order.status,
        to: nextStatus,
      },
      { status: 400 },
    );
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: nextStatus },
    select: { id: true, status: true },
  });

  // P6-T7 follow-up (d-полное): аудит движения склада через StockLog.
  //  - shipped → commitOrderShipment: quantity-=qty + reserved-=qty.
  //  - cancelled/refunded → releaseOrderStock: reserved-=qty (qty не трогаем).
  // Best-effort — не валим status-change если что-то пошло не так
  // (skipped[] записывается в PaymentLog для трейсабельности).
  if (nextStatus === "shipped") {
    const movement = await commitOrderShipment({
      orderId: order.id,
      adminUserId: auth.userId,
    });
    if (movement.skipped.length > 0 || movement.committed.length > 0) {
      await writePaymentLog({
        paymentId: order.payments[0]?.id ?? null,
        action: "order.shipment_committed",
        request: { orderId: order.id, adminId: auth.userId },
        response: { committed: movement.committed, skipped: movement.skipped },
        statusCode: 200,
      });
    }
  } else if (nextStatus === "cancelled" || nextStatus === "refunded") {
    const movement = await releaseOrderStock({
      orderId: order.id,
      adminUserId: auth.userId,
    });
    if (movement.skipped.length > 0 || movement.committed.length > 0) {
      await writePaymentLog({
        paymentId: order.payments[0]?.id ?? null,
        action: "order.stock_released",
        request: { orderId: order.id, adminId: auth.userId, reason: nextStatus },
        response: { committed: movement.committed, skipped: movement.skipped },
        statusCode: 200,
      });
    }
    // P7-T2 sub-task A: reverse loyalty операций (refund + clawback).
    // Idempotent: повторный cancel→refunded transition не задвоит reversal.
    const reversal = await prisma.$transaction(async (tx) => {
      return reverseLoyaltyForOrder(tx, order.id);
    });
    if (!reversal.alreadyReversed && (reversal.refunded > 0 || reversal.clawedBack > 0)) {
      await writePaymentLog({
        paymentId: order.payments[0]?.id ?? null,
        action: "loyalty.reversed",
        request: { orderId: order.id, adminId: auth.userId, reason: nextStatus },
        response: { refunded: reversal.refunded, clawedBack: reversal.clawedBack },
        statusCode: 200,
      });
    }
  } else if (nextStatus === "delivered") {
    // P7-T1 sub-task A: COD-капчура «деньги в руке».
    // Захватываем все pending COD-платежи заказа + в той же атомарной TX
    // бампаем Promo.usedCount (если у заказа есть promoCode). Для Uniteller
    // капчура уже произошла раньше через webhook — фильтр `provider: "cod"`
    // + `status: "pending"` гарантирует, что мы не double-bump'нем счётчик.
    const codPending = order.payments.filter((p) => p.provider === "cod" && p.status === "pending");
    if (codPending.length > 0) {
      const now = new Date();
      const promoCodeToBump = order.promoCode;
      // P7-T2 sub-task F: процент earn'а — live из `features` row.
      const earnPercent = await getLoyaltyEarnPercent();
      let awardedPoints = 0;
      await prisma.$transaction(async (tx) => {
        for (const p of codPending) {
          await tx.payment.update({
            where: { id: p.id },
            data: { status: "captured", capturedAt: now },
          });
        }
        await incrementPromoUsage(tx, promoCodeToBump);
        // P7-T2: начисление баллов «Бигмах Бонус» в той же TX. computeEarnedPoints
        // считает N% от totalCents; для < 10_000 тийн (100 сум при 1%) даёт 0 → silent.
        awardedPoints = await awardLoyaltyPoints(tx, {
          userId: order.userId,
          orderId: order.id,
          totalCents: order.totalCents,
          percent: earnPercent,
        });
      });
      await writePaymentLog({
        paymentId: codPending[0]?.id ?? null,
        action: "cod.captured_on_delivery",
        request: { orderId: order.id, adminId: auth.userId },
        response: {
          captured: codPending.map((p) => p.id),
          promoBumped: promoCodeToBump ?? null,
          loyaltyAwarded: awardedPoints,
        },
        statusCode: 200,
      });
    }
  }

  await writePaymentLog({
    paymentId: order.payments[0]?.id ?? null,
    action: "order.status_change",
    request: {
      orderId: order.id,
      from: order.status,
      to: nextStatus,
      reason: reason ?? null,
      adminId: auth.userId,
      adminEmail: auth.email,
    },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, id: updated.id, status: updated.status },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
