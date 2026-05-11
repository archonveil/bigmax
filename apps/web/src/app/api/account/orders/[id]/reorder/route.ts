/**
 * `POST /api/account/orders/[id]/reorder` (P5-T2).
 *
 * Загружает позиции прошлого заказа в формате `CartItemInput` для текущей
 * корзины. Owner-only — на чужой Order возвращает 404 (не 403, чтобы не
 * подтверждать существование чужих ID).
 *
 * Не пишет в саму корзину — она в localStorage. Клиент берёт `addedItems`
 * и делает `useCart.add()` для каждого, мерджа quantities на своей стороне.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { loadOrderItemsForReorder } from "@/server/order-reorder";

interface RouteContext {
  params: { id: string };
}

export async function POST(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await loadOrderItemsForReorder(session.user.id, ctx.params.id);
  if (!result) {
    // Owner-mismatch ИЛИ заказ не существует → одинаковый 404 ответ.
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store, private" },
  });
}
