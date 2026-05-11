/**
 * `POST /api/admin/stock/[id]/adjust` (P6-T7).
 *
 * Адресная корректировка `Stock.quantity` через `set`/`inc`/`dec` с reason.
 * Atomic transaction:
 *  1. SELECT текущий `Stock.quantity` (для oldQty в audit).
 *  2. `applyAdjust(oldQty, mode, value)` → newQty (clamp на 0).
 *  3. `prisma.stock.update(quantity: newQty)`.
 *  4. `prisma.stockLog.create({action: mode, ...})`.
 *
 * Response:
 *  - 200 `{ ok, oldQty, newQty, delta }`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 404 `not_found` если Stock.id не существует
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { StockAdjustSchema, applyAdjust } from "@/server/admin-stock";

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
  const parsed = StockAdjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { mode, value, reason } = parsed.data;

  const stock = await prisma.stock.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, quantity: true, variantId: true, branchId: true },
  });
  if (!stock) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const oldQty = stock.quantity;
  const newQty = applyAdjust(oldQty, mode, value);

  // Если new == old → no-op, не пишем audit-row (избегаем замусоривания
  // лога). Возвращаем 200 с ok=true для idempotency.
  if (newQty === oldQty) {
    return NextResponse.json(
      { ok: true, oldQty, newQty, delta: 0, noop: true },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stock.update({
      where: { id: stock.id },
      data: { quantity: newQty },
      select: { id: true },
    });
    await tx.stockLog.create({
      data: {
        stockId: stock.id,
        variantId: stock.variantId,
        branchId: stock.branchId,
        action: mode,
        oldQty,
        newQty,
        delta: newQty - oldQty,
        reason,
        adminUserId: auth.userId,
      } satisfies Prisma.StockLogUncheckedCreateInput,
      select: { id: true },
    });
  });

  return NextResponse.json(
    { ok: true, oldQty, newQty, delta: newQty - oldQty },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
