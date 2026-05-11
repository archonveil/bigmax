/**
 * `PATCH /api/admin/products/[id]` — update (любой набор полей из
 * `ProductUpdateSchema`).
 * `DELETE /api/admin/products/[id]` — soft-delete (`isActive = false`),
 * не hard-delete: OrderItem'ы по FK на ProductVariant держат references,
 * физическое удаление прорастёт через cascade и потеряет историю заказов.
 */

import { Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { type AttributeValue, validateAttributes } from "@/catalog/category-attributes";
import { requireAdminSession } from "@/server/admin-auth";
import { ProductUpdateSchema, syncProductColorFromVariants } from "@/server/admin-products";
import { getCategoryAttributes } from "@/server/category-attributes";

interface RouteContext {
  params: { id: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = ProductUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Сначала проверяем существование (404 на отсутствующий id, не пустой PATCH).
  // Если `data.categoryId` есть в payload'е, используем его (admin меняет
  // категорию + attributes одновременно); иначе — текущую категорию product'а.
  const exists = await prisma.product.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, categoryId: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  let categoryIdForAttrs = exists.categoryId;
  if (data.categoryId && data.categoryId !== exists.categoryId) {
    const newCat = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!newCat) {
      return NextResponse.json(
        { ok: false, reason: "invalid_relation", message: "category not found" },
        { status: 400 },
      );
    }
    categoryIdForAttrs = newCat.id;
  }
  let sanitizedAttrs: Record<string, AttributeValue> | null | undefined;
  if (data.attributes !== undefined) {
    const attrConfig = await getCategoryAttributes(categoryIdForAttrs);
    const result = validateAttributes(attrConfig, data.attributes);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: `attribute_${result.reason}`,
          key: result.key,
        },
        { status: 400 },
      );
    }
    sanitizedAttrs = result.sanitized;
  }

  try {
    // Картинки управляются ТОЛЬКО через variant routes — здесь скалярные
    // поля + attributes. Без $transaction'и (один update).
    const updated = await prisma.product.update({
      where: { id: ctx.params.id },
      data: {
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.brandId !== undefined ? { brandId: data.brandId ?? null } : {}),
        ...(data.nameRu !== undefined ? { nameRu: data.nameRu } : {}),
        ...(data.nameUz !== undefined ? { nameUz: data.nameUz } : {}),
        ...(data.nameEn !== undefined ? { nameEn: data.nameEn } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.descriptionRu !== undefined ? { descriptionRu: data.descriptionRu } : {}),
        ...(data.descriptionUz !== undefined ? { descriptionUz: data.descriptionUz } : {}),
        ...(data.descriptionEn !== undefined ? { descriptionEn: data.descriptionEn } : {}),
        ...(data.ageFromMonths !== undefined ? { ageFromMonths: data.ageFromMonths } : {}),
        ...(data.ageToMonths !== undefined ? { ageToMonths: data.ageToMonths } : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {}),
        ...(sanitizedAttrs !== undefined
          ? {
              attributes:
                sanitizedAttrs === null ? Prisma.DbNull : (sanitizedAttrs as Prisma.InputJsonValue),
            }
          : {}),
      },
      select: { id: true, slug: true },
    });
    // Sync color только если category РЕАЛЬНО поменялась (новый config мог
    // не иметь color-attribute, или иметь другой набор values). НЕ на каждом
    // PATCH — иначе admin'овский ручной edit attributes.color затирался бы
    // variant-derived массивом сразу после save (regression-safe).
    if (data.categoryId !== undefined && data.categoryId !== exists.categoryId) {
      await syncProductColorFromVariants(updated.id);
    }
    return NextResponse.json(
      { ok: true, id: updated.id, slug: updated.slug },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : null;
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    if (code === "P2003" || code === "P2025") {
      return NextResponse.json({ ok: false, reason: "invalid_relation" }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Soft-delete: isActive=false. Hard-delete отложен в P8 (нужен cascade-
  // план через OrderItem.variant references).
  const exists = await prisma.product.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  await prisma.product.update({
    where: { id: ctx.params.id },
    data: { isActive: false },
    select: { id: true },
  });
  return NextResponse.json(
    { ok: true, deactivated: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
