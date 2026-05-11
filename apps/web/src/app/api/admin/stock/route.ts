/**
 * `POST /api/admin/stock` (P6-T7).
 *
 * Upsert на (variantId, branchId) — создаёт новую запись если её нет,
 * или обновляет quantity если уже есть. Atomic transaction:
 *  1. `prisma.stock.upsert` (по unique-индексу `[variantId, branchId]`).
 *  2. `prisma.stockLog.create({action: "create" | "set", ...})` — audit
 *     с oldQty/newQty/delta.
 *
 * Response:
 *  - 200 `{ ok, id, quantity, created: bool }`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 400 `invalid_relation` если variantId/branchId не существуют (P2003)
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { StockUpsertSchema } from "@/server/admin-stock";

function prismaCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return null;
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
  const parsed = StockUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { variantId, branchId, quantity, reason } = parsed.data;

  try {
    const existing = await prisma.stock.findUnique({
      where: { variantId_branchId: { variantId, branchId } },
      select: { id: true, quantity: true },
    });
    const oldQty = existing?.quantity ?? 0;
    const created = !existing;
    const action = created ? "create" : "set";

    const stock = await prisma.$transaction(async (tx) => {
      const s = await tx.stock.upsert({
        where: { variantId_branchId: { variantId, branchId } },
        create: { variantId, branchId, quantity, reserved: 0 },
        update: { quantity },
        select: { id: true, quantity: true },
      });
      await tx.stockLog.create({
        data: {
          stockId: s.id,
          variantId,
          branchId,
          action,
          oldQty,
          newQty: s.quantity,
          delta: s.quantity - oldQty,
          reason,
          adminUserId: auth.userId,
        } satisfies Prisma.StockLogUncheckedCreateInput,
        select: { id: true },
      });
      return s;
    });

    return NextResponse.json(
      { ok: true, id: stock.id, quantity: stock.quantity, created },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    const code = prismaCode(err);
    if (code === "P2003" || code === "P2025") {
      return NextResponse.json({ ok: false, reason: "invalid_relation" }, { status: 400 });
    }
    throw err;
  }
}
