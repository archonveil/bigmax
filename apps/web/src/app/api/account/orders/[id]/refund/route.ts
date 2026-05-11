/**
 * `POST /api/account/orders/[id]/refund` (P5-T2).
 *
 * Создаёт `Refund(status=pending)` от имени пользователя для последующей
 * ручной модерации в admin-панели (P6-T6 § master-prompt 5.9). Не дёргает
 * Uniteller — admin одобряет/отклоняет позже.
 *
 * Owner-only — на чужой Order возвращает 404. Eligibility-проверка через
 * `validateRefundEligibility` (см. `order-actions.ts`):
 *   - есть captured Payment
 *   - Order.status !== cancelled
 *   - нет уже-pending или уже-completed Refund'а на этом Payment'е
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getOrderDetail } from "@/server/account-order-detail";
import { RefundRequestSchema, validateRefundEligibility } from "@/server/order-actions";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Тело — JSON `{reason: string}` (10..1000 chars).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = RefundRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  // Owner-проверка через `getOrderDetail` — возвращает null на чужой Order.
  const order = await getOrderDetail(session.user.id, ctx.params.id);
  if (!order) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const eligibility = validateRefundEligibility({
    order: { status: order.status },
    payments: order.payments,
    refunds: order.refunds,
  });
  if (!eligibility.eligible) {
    return NextResponse.json(
      { ok: false, reason: eligibility.reason },
      { status: 409 }, // Conflict — состояние не позволяет
    );
  }

  // Создаём Refund + audit-log одной транзакцией. PaymentLog нужен для P6-T6
  // admin-вьюшки (история refund-запросов).
  const created = await prisma.refund.create({
    data: {
      paymentId: eligibility.paymentId,
      amountCents: eligibility.amountCents,
      reason: parsed.data.reason,
      initiatedByUserId: session.user.id,
      status: "pending",
    },
    select: { id: true, paymentId: true, amountCents: true, status: true, createdAt: true },
  });

  await writePaymentLog({
    paymentId: eligibility.paymentId,
    action: "refund_requested",
    request: { refundId: created.id, reason: parsed.data.reason },
    statusCode: 201,
  });

  return NextResponse.json(
    {
      ok: true,
      refund: {
        id: created.id,
        paymentId: created.paymentId,
        amountCents: created.amountCents,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201, headers: { "Cache-Control": "no-store, private" } },
  );
}
