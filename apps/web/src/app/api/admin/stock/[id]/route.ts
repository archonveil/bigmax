/**
 * `DELETE /api/admin/stock/[id]` (P6-T7).
 *
 * Hard-delete (variant, branch) — используется когда товар физически
 * больше не хранится в этом филиале. Перед удалением:
 *  - Если `Stock.reserved > 0` → 409 `has_reserved` (есть pending-заказы
 *    которые держат резерв; admin должен сначала их обработать).
 *  - Иначе пишем `StockLog(action="delete")` + delete-row. StockLog
 *    остаётся (FK SetNull) — audit сохраняется.
 *
 * Response:
 *  - 200 `{ ok, deleted: true }`
 *  - 401/404 от requireAdminSession
 *  - 404 not_found
 *  - 409 has_reserved
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";

interface RouteContext {
  params: { id: string };
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const stock = await prisma.stock.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, quantity: true, reserved: true, variantId: true, branchId: true },
  });
  if (!stock) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  if (stock.reserved > 0) {
    return NextResponse.json(
      { ok: false, reason: "has_reserved", reserved: stock.reserved },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockLog.create({
      data: {
        stockId: stock.id,
        variantId: stock.variantId,
        branchId: stock.branchId,
        action: "delete",
        oldQty: stock.quantity,
        newQty: 0,
        delta: -stock.quantity,
        reason: "manual delete by admin",
        adminUserId: auth.userId,
      } satisfies Prisma.StockLogUncheckedCreateInput,
      select: { id: true },
    });
    await tx.stock.delete({ where: { id: stock.id }, select: { id: true } });
  });

  return NextResponse.json(
    { ok: true, deleted: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
