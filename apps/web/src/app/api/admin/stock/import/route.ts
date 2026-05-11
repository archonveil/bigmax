/**
 * `POST /api/admin/stock/import` (P6-T7).
 *
 * CSV-импорт остатков. Header-валидация: `sku`, `quantity` обязательны;
 * `branch_slug` ИЛИ `branch_id` обязателен (не оба обязательны). Per-row:
 *  1. Resolve variant by SKU → 404 в skipped[] если не найден.
 *  2. Resolve branch by `branch_id` (cuid) ИЛИ `branch_slug` (новое поле
 *     `StoreBranch.slug`, P6-T7 follow-up — закрывает (a)). Если ни один
 *     не нашёлся в БД → row → skipped[branch_not_found].
 *  3. `prisma.stock.upsert({variantId_branchId})` + StockLog с action="import".
 *
 * Per-row failures накапливаются в `skipped[]`, остальные импортятся
 * (best-effort, не валит весь batch).
 *
 * Body: `text/csv` (raw text). Max 1000 rows.
 *
 * Response:
 *  - 200 `{ok, processed: N, skipped: [{row, sku, reason}]}`
 *  - 400 invalid_body / missing_columns / empty / too_many_rows
 *  - 401/404 от requireAdminSession
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { StockImportRowSchema, parseStockCsv } from "@/server/admin-stock";

interface SkippedItem {
  row: number;
  sku: string;
  reason: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const text = await req.text().catch(() => "");
  if (!text) {
    return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  }

  const csvParsed = parseStockCsv(text);
  if (!csvParsed.ok) {
    return NextResponse.json({ ok: false, reason: csvParsed.reason }, { status: 400 });
  }

  // Pre-fetch all variants + branches упомянутые в файле — батчами, чтобы не
  // делать N+1.
  const skuSet = new Set<string>();
  const branchKeySet = new Set<string>();
  const validatedRows: Array<{ row: number; sku: string; branchKey: string; quantity: number }> =
    [];
  for (let i = 0; i < csvParsed.rows.length; i += 1) {
    const r = StockImportRowSchema.safeParse(csvParsed.rows[i]);
    if (!r.success) {
      // Невалидная строка - помечаем сразу.
      const rawSku = csvParsed.rows[i]?.["sku"] ?? "?";
      validatedRows.push({ row: i + 2, sku: rawSku, branchKey: "", quantity: -1 });
      continue;
    }
    const branchKey = r.data.branch_id ?? r.data.branch_slug ?? "";
    skuSet.add(r.data.sku);
    if (branchKey) branchKeySet.add(branchKey);
    validatedRows.push({
      row: i + 2,
      sku: r.data.sku,
      branchKey,
      quantity: r.data.quantity,
    });
  }

  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: [...skuSet] } },
    select: { id: true, sku: true },
  });
  const variantBySku = new Map(variants.map((v) => [v.sku, v.id]));

  // Branches: ищем по id (cuid) ИЛИ slug (P6-T7 follow-up — slug стал
  // первоклассным полем StoreBranch.slug).
  const branches = await prisma.storeBranch.findMany({
    where: {
      OR: [{ id: { in: [...branchKeySet] } }, { slug: { in: [...branchKeySet] } }],
    },
    select: { id: true, slug: true },
  });
  const branchByKey = new Map<string, string>();
  for (const b of branches) {
    branchByKey.set(b.id, b.id);
    if (b.slug) branchByKey.set(b.slug, b.id);
  }

  let processed = 0;
  const skipped: SkippedItem[] = [];

  for (const v of validatedRows) {
    if (v.quantity < 0) {
      skipped.push({ row: v.row, sku: v.sku, reason: "invalid_row" });
      continue;
    }
    const variantId = variantBySku.get(v.sku);
    if (!variantId) {
      skipped.push({ row: v.row, sku: v.sku, reason: "variant_not_found" });
      continue;
    }
    const branchId = branchByKey.get(v.branchKey);
    if (!branchId) {
      skipped.push({ row: v.row, sku: v.sku, reason: "branch_not_found" });
      continue;
    }

    const existing = await prisma.stock.findUnique({
      where: { variantId_branchId: { variantId, branchId } },
      select: { id: true, quantity: true },
    });
    const oldQty = existing?.quantity ?? 0;
    if (oldQty === v.quantity) {
      // No-op — пропускаем audit-row.
      processed += 1;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        const s = await tx.stock.upsert({
          where: { variantId_branchId: { variantId, branchId } },
          create: { variantId, branchId, quantity: v.quantity, reserved: 0 },
          update: { quantity: v.quantity },
          select: { id: true, quantity: true },
        });
        await tx.stockLog.create({
          data: {
            stockId: s.id,
            variantId,
            branchId,
            action: "import",
            oldQty,
            newQty: s.quantity,
            delta: s.quantity - oldQty,
            reason: `CSV import (row ${v.row})`,
            adminUserId: auth.userId,
          } satisfies Prisma.StockLogUncheckedCreateInput,
          select: { id: true },
        });
      });
      processed += 1;
    } catch {
      skipped.push({ row: v.row, sku: v.sku, reason: "db_error" });
    }
  }

  return NextResponse.json(
    { ok: true, processed, skipped },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
