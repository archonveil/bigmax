import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { CategoryUpdateSchema, prismaErrorCode } from "@/server/admin-taxonomy";
import { TAXONOMY_TAG } from "@/server/catalog";

function bustCategoryCaches(): void {
  invalidateAdminProductDictionariesCache();
  revalidatePath("/[locale]/admin/categories", "page");
  revalidatePath("/[locale]/admin/categories/[id]", "page");
  revalidatePath("/[locale]/admin/products", "page");
  // Storefront catalog tree зависит от категорий.
  revalidatePath("/[locale]/catalog", "layout");
  // P2-25: ломаем `unstable_cache(getActiveCategories/Brands/CategoryTree)`.
  revalidateTag(TAXONOMY_TAG);
}

interface Ctx {
  params: { id: string };
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
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
  const parsed = CategoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const exists = await prisma.category.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  // parentId === self → bad request (нельзя сделать категорию своим предком).
  if (parsed.data.parentId === ctx.params.id) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "parent_cycle" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  try {
    const updated = await prisma.category.update({
      where: { id: ctx.params.id },
      data: {
        ...(data.nameRu !== undefined ? { nameRu: data.nameRu } : {}),
        ...(data.nameUz !== undefined ? { nameUz: data.nameUz } : {}),
        ...(data.nameEn !== undefined ? { nameEn: data.nameEn } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.iconUrl !== undefined ? { iconUrl: data.iconUrl } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: { id: true, slug: true },
    });
    bustCategoryCaches();
    return NextResponse.json({ ok: true, ...updated }, { status: 200 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    if (code === "P2003" || code === "P2025") {
      return NextResponse.json({ ok: false, reason: "invalid_relation" }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Pre-check: products linked → 409 (Product → Category onDelete:Restrict).
  const exists = await prisma.category.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, _count: { select: { products: true } } },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  if (exists._count.products > 0) {
    return NextResponse.json(
      { ok: false, reason: "category_in_use", productsCount: exists._count.products },
      { status: 409 },
    );
  }
  try {
    await prisma.category.delete({ where: { id: ctx.params.id }, select: { id: true } });
    bustCategoryCaches();
    return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2003") {
      return NextResponse.json({ ok: false, reason: "category_in_use" }, { status: 409 });
    }
    throw err;
  }
}
