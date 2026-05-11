/**
 * `POST /api/admin/products` — create product (P6-T3).
 *
 * Auth: admin/manager (через `requireAdminSession`). Body: `ProductCreateSchema`.
 * Уникальные конфликты:
 *   - `slug` unique → 409 `slug_exists`.
 *   - неизвестный `categoryId` / `brandId` → 400 `invalid_relation`.
 */

import { type Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { validateAttributes } from "@/catalog/category-attributes";
import { requireAdminSession } from "@/server/admin-auth";
import { ProductCreateSchema } from "@/server/admin-products";
import { getCategoryAttributes } from "@/server/category-attributes";

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
  const parsed = ProductCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Проверяем существование категории + получаем DB-driven attribute-config.
  const category = await prisma.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json(
      { ok: false, reason: "invalid_relation", message: "category not found" },
      { status: 400 },
    );
  }
  const attrConfig = await getCategoryAttributes(category.id);
  const attrsResult = validateAttributes(attrConfig, data.attributes);
  if (!attrsResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: `attribute_${attrsResult.reason}`,
        key: attrsResult.key,
      },
      { status: 400 },
    );
  }

  try {
    // Картинки товара создаются вместе с variant'ами (см. variants POST/PATCH),
    // не на product-уровне → одиночный create без вложенной transaction'и.
    const created = await prisma.product.create({
      data: {
        categoryId: data.categoryId,
        brandId: data.brandId ?? null,
        nameRu: data.nameRu,
        nameUz: data.nameUz ?? "",
        nameEn: data.nameEn ?? "",
        slug: data.slug,
        descriptionRu: data.descriptionRu ?? null,
        descriptionUz: data.descriptionUz ?? null,
        descriptionEn: data.descriptionEn ?? null,
        ageFromMonths: data.ageFromMonths ?? null,
        ageToMonths: data.ageToMonths ?? null,
        gender: data.gender,
        isActive: data.isActive,
        isFeatured: data.isFeatured,
        ...(attrsResult.sanitized
          ? { attributes: attrsResult.sanitized as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true, slug: true },
    });
    return NextResponse.json(
      { ok: true, id: created.id, slug: created.slug },
      { status: 201, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    // Используем `code` вместо `instanceof Prisma.PrismaClientKnownRequestError`
    // потому что webpack дублирует Prisma-модули → instanceof срабатывает не
    // всегда в dev-server (production-build делал бы single-instance).
    const code =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : null;
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    if (code === "P2003" || code === "P2025") {
      return NextResponse.json(
        { ok: false, reason: "invalid_relation", message: "category or brand not found" },
        { status: 400 },
      );
    }
    throw err;
  }
}
