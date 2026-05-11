/**
 * `POST /api/admin/products/import` (P6-T3) — bulk-импорт через CSV.
 *
 * Формат: `text/csv` body, header c обязательными `slug, name_ru, name_uz,
 * name_en, category_slug` + опц. `brand_slug, description_ru/uz/en,
 * age_from_months, age_to_months, gender`. `category_slug` / `brand_slug`
 * резолвятся в id'шники по slug — admin не должен помнить cuid'ы.
 *
 * Транзакция: каждая row создаёт Product через `upsert` (по `slug`). Если
 * row невалидна — откатывается **только эта строка**, остальные импортятся.
 * Возвращаем `{created, updated, skipped: [{row, reason}]}` — admin видит
 * что не пролилось.
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { parseCsv, ProductCsvRowSchema } from "@/server/admin-products";

interface SkippedRow {
  rowIndex: number;
  reason: string;
  detail?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Принимаем text/csv ИЛИ application/octet-stream (curl без content-type).
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "could not read body" },
      { status: 400 },
    );
  }
  if (text.trim() === "") {
    return NextResponse.json({ ok: false, reason: "empty_body" }, { status: 400 });
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, reason: parsed.reason, missing: parsed.missing ?? null },
      { status: 400 },
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ ok: false, reason: "empty_body" }, { status: 400 });
  }
  if (parsed.rows.length > 1000) {
    return NextResponse.json({ ok: false, reason: "too_many_rows", max: 1000 }, { status: 413 });
  }

  // Резолвим category_slug / brand_slug → id'шники одним batch.
  const categorySlugs = new Set(parsed.rows.map((r) => r["category_slug"]).filter(Boolean));
  const brandSlugs = new Set(parsed.rows.map((r) => r["brand_slug"]).filter(Boolean));
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      where: { slug: { in: [...categorySlugs] as string[] } },
      select: { id: true, slug: true },
    }),
    brandSlugs.size > 0
      ? prisma.brand.findMany({
          where: { slug: { in: [...brandSlugs] as string[] } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([] as Array<{ id: string; slug: string }>),
  ]);
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const brandBySlug = new Map(brands.map((b) => [b.slug, b.id]));

  let created = 0;
  let updated = 0;
  const skipped: SkippedRow[] = [];

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const raw = parsed.rows[i]!;
    const rowParsed = ProductCsvRowSchema.safeParse(raw);
    if (!rowParsed.success) {
      skipped.push({
        rowIndex: i + 2, // +2 — 1 для header'а + 1 чтобы 1-based для admin'а
        reason: "invalid_row",
        detail: rowParsed.error.issues[0]?.message ?? "validation_failed",
      });
      continue;
    }
    const row = rowParsed.data;
    const categoryId = categoryBySlug.get(row.category_slug);
    if (!categoryId) {
      skipped.push({
        rowIndex: i + 2,
        reason: "unknown_category",
        detail: row.category_slug,
      });
      continue;
    }
    const brandId = row.brand_slug ? (brandBySlug.get(row.brand_slug) ?? null) : null;
    if (row.brand_slug && !brandId) {
      skipped.push({
        rowIndex: i + 2,
        reason: "unknown_brand",
        detail: row.brand_slug,
      });
      continue;
    }

    try {
      const data = {
        categoryId,
        brandId,
        nameRu: row.name_ru,
        nameUz: row.name_uz ?? "",
        nameEn: row.name_en ?? "",
        slug: row.slug,
        descriptionRu: row.description_ru ?? null,
        descriptionUz: row.description_uz ?? null,
        descriptionEn: row.description_en ?? null,
        ageFromMonths: row.age_from_months ?? null,
        ageToMonths: row.age_to_months ?? null,
        gender: row.gender ?? "unisex",
      };
      const result = await prisma.product.upsert({
        where: { slug: row.slug },
        create: { ...data, isActive: true, isFeatured: false },
        update: data,
        select: { id: true, createdAt: true, updatedAt: true },
      });
      // upsert не различает create vs update в return — судим по timestamp'ам.
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created += 1;
      } else {
        updated += 1;
      }
    } catch (err) {
      // Маппим Prisma-ошибки в reason-коды для UI. `code` вместо instanceof —
      // см. note в `route.ts` POST о webpack-границах.
      const code =
        err && typeof err === "object" && "code" in err && typeof err.code === "string"
          ? err.code
          : null;
      const reason = code === "P2002" ? "slug_conflict" : "db_error";
      skipped.push({
        rowIndex: i + 2,
        reason,
        detail: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  }

  return NextResponse.json(
    { ok: true, created, updated, skipped },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
