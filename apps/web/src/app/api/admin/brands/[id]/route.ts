import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { BrandUpdateSchema, prismaErrorCode } from "@/server/admin-taxonomy";
import { TAXONOMY_TAG } from "@/server/catalog";

function bustBrandCaches(): void {
  invalidateAdminProductDictionariesCache();
  revalidatePath("/[locale]/admin/brands", "page");
  revalidatePath("/[locale]/admin/brands/[id]", "page");
  revalidatePath("/[locale]/admin/products", "page");
  // P2-25: ломает `unstable_cache(getActiveBrands)` storefront-стороны.
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
  const parsed = BrandUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const exists = await prisma.brand.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  const data = parsed.data;
  try {
    const updated = await prisma.brand.update({
      where: { id: ctx.params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
      },
      select: { id: true, slug: true },
    });
    bustBrandCaches();
    return NextResponse.json({ ok: true, ...updated }, { status: 200 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Brand → Product onDelete:SetNull, hard-delete безопасен.
  const exists = await prisma.brand.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  await prisma.brand.delete({ where: { id: ctx.params.id }, select: { id: true } });
  bustBrandCaches();
  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}
