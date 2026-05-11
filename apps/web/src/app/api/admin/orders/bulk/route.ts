/**
 * `POST /api/admin/orders/bulk` (P6-T5 follow-up — closes open question (c)).
 *
 * Bulk-смена статуса для до 200 заказов одним кликом. Каждый id
 * валидируется через state-machine `canTransitionOrderStatus`; провалы
 * собираются в `skipped[]` с reason'ом (`not_found` /
 * `illegal_transition` / `status_unchanged`), не валят весь batch.
 *
 * Каждое успешное изменение пишется в `PaymentLog` (`order.status_change`)
 * с `bulk: true` flag'ом для audit'а — отличается от single-call'а из
 * `[id]/status` и помогает разобраться при анализе incident'ов.
 *
 * Response:
 *  - 200 `{ ok, updated, skipped: [{id, reason}] }` — даже если updated=0,
 *    но запрос валидный
 *  - 400 invalid_body
 *  - 401 / 404 от `requireAdminSession`
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { OrderBulkStatusSchema, canTransitionOrderStatus } from "@/server/admin-orders";
import { writePaymentLogs } from "@/server/payment-log";

interface SkippedItem {
  id: string;
  reason: "not_found" | "illegal_transition" | "status_unchanged";
}

export async function POST(req: NextRequest): Promise<Response> {
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
  const parsed = OrderBulkStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { ids, status: nextStatus, reason } = parsed.data;
  // Дедуп — admin мог по неосторожности отправить дубль; всё равно отрабатываем
  // только уникальные id'шники.
  const uniqueIds = Array.from(new Set(ids));

  const orders = await prisma.order.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, status: true, payments: { select: { id: true }, take: 1 } },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  const skipped: SkippedItem[] = [];
  const toUpdate: Array<{ id: string; from: string; paymentId: string | null }> = [];

  for (const id of uniqueIds) {
    const order = byId.get(id);
    if (!order) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    if (order.status === nextStatus) {
      skipped.push({ id, reason: "status_unchanged" });
      continue;
    }
    if (!canTransitionOrderStatus(order.status, nextStatus)) {
      skipped.push({ id, reason: "illegal_transition" });
      continue;
    }
    toUpdate.push({
      id: order.id,
      from: order.status,
      paymentId: order.payments[0]?.id ?? null,
    });
  }

  let updated = 0;
  if (toUpdate.length > 0) {
    const result = await prisma.order.updateMany({
      where: { id: { in: toUpdate.map((u) => u.id) } },
      data: { status: nextStatus },
    });
    updated = result.count;

    // PaymentLog audit для каждого успешного перехода — bulk-insert (P0-5),
    // best-effort (writePaymentLogs не throw'ит).
    await writePaymentLogs(
      toUpdate.map((u) => ({
        paymentId: u.paymentId,
        action: "order.status_change",
        request: {
          orderId: u.id,
          from: u.from,
          to: nextStatus,
          reason: reason ?? null,
          adminId: auth.userId,
          adminEmail: auth.email,
          bulk: true,
        },
        statusCode: 200,
      })),
    );
  }

  return NextResponse.json(
    { ok: true, updated, skipped },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
