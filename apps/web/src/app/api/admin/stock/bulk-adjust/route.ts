/**
 * `POST /api/admin/stock/bulk-adjust` (P6-T7 follow-up — closes (b)).
 *
 * Применяет один и тот же adjust ко всем Stock-row'ам в branch,
 * отфильтрованным по SKU-pattern'у (`NB-*`, `*-PK`, и т.д.). Каждое
 * изменение — отдельный StockLog. Pre-fetch всех matching-rows с
 * `take: limit` (default 200) → loop с per-row transaction'ом.
 *
 * Sequential (не Promise.all) — pattern такой же как `bulk-refund`:
 * избегаем DB-overload параллельными UPDATE'ами + один stalled row не
 * блокирует остальные. Ответ:
 *  - 200 `{ok, processed, skipped: [{stockId, sku, reason: "noop"}]}`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 200 + processed=0 если pattern ни на что не матчит (пустой результат
 *    не error — admin увидит counter и подкорректирует pattern).
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { StockBulkAdjustSchema, applyAdjust, skuPatternToLike } from "@/server/admin-stock";

interface SkippedItem {
  stockId: string;
  sku: string;
  reason: "noop" | "db_error";
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
  const parsed = StockBulkAdjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { branchId, skuPattern, mode, value, reason, limit } = parsed.data;
  const likePattern = skuPatternToLike(skuPattern);

  const matching = await prisma.stock.findMany({
    where: {
      branchId,
      variant: { sku: { contains: likePattern, mode: "insensitive" as const } },
    },
    take: limit,
    select: {
      id: true,
      quantity: true,
      variantId: true,
      variant: { select: { sku: true } },
    },
  });

  // Если admin использовал `*` — нужно SQL LIKE (не contains). Делаем
  // post-filter через regex после fetch'а — для ≤ 200 rows это копеечно.
  const regex = new RegExp(
    `^${skuPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  );
  const filtered = matching.filter((m) => regex.test(m.variant.sku));

  let processed = 0;
  const skipped: SkippedItem[] = [];

  for (const s of filtered) {
    const newQty = applyAdjust(s.quantity, mode, value);
    if (newQty === s.quantity) {
      skipped.push({ stockId: s.id, sku: s.variant.sku, reason: "noop" });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.stock.update({
          where: { id: s.id },
          data: { quantity: newQty },
          select: { id: true },
        });
        await tx.stockLog.create({
          data: {
            stockId: s.id,
            variantId: s.variantId,
            branchId,
            action: mode,
            oldQty: s.quantity,
            newQty,
            delta: newQty - s.quantity,
            reason: `bulk: ${reason}`,
            adminUserId: auth.userId,
          } satisfies Prisma.StockLogUncheckedCreateInput,
          select: { id: true },
        });
      });
      processed += 1;
    } catch {
      skipped.push({ stockId: s.id, sku: s.variant.sku, reason: "db_error" });
    }
  }

  return NextResponse.json(
    { ok: true, processed, skipped, matched: filtered.length },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
