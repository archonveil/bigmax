/**
 * `GET /api/orders/[id]/status` — снимок статуса заказа для return-страниц
 * Uniteller (P4-T7). Owner-gated: 401 если нет session, 404 если заказ не
 * существует или принадлежит другому юзеру (404 а не 403, чтобы не
 * раскрывать наличие чужих ID-ов).
 *
 * Polling используется на success/failure/return страницах сразу после
 * редиректа от Uniteller, пока webhook не обновит `Payment.status` (обычно
 * <2с в проде, но в dev/staging бывает дольше из-за моков).
 */

import { prisma } from "@bigmax/db";
import type { OrderStatusResponse } from "@bigmax/shared-types";
import { NextResponse } from "next/server";

import { auth } from "@/auth";

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      number: true,
      status: true,
      userId: true,
      totalCents: true,
      currency: true,
      locale: true,
      payments: {
        select: { status: true, provider: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  // Слитное условие notFound/forbidden — не раскрываем, что чужой заказ
  // существует. Owner-mismatch отдаёт тот же 404.
  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  // У заказа должен быть хотя бы один Payment (создаётся в P4-T5 транзакцией);
  // если по каким-то причинам отсутствует — возвращаем 404 (внутреннее
  // состояние некорректно, не показываем юзеру pending/captured неоднозначно).
  const payment = order.payments[0];
  if (!payment) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const body: OrderStatusResponse = {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: payment.status,
    paymentProvider: payment.provider,
    totalCents: order.totalCents,
    currency: order.currency,
    locale: order.locale,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store, private" },
  });
}
