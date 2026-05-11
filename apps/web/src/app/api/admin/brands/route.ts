import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { BrandCreateSchema, prismaErrorCode } from "@/server/admin-taxonomy";
import { TAXONOMY_TAG } from "@/server/catalog";

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
  const parsed = BrandCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;
  try {
    const created = await prisma.brand.create({
      data: {
        name: data.name,
        slug: data.slug,
        logoUrl: data.logoUrl ?? null,
        description: data.description ?? null,
        country: data.country ?? null,
      },
      select: { id: true, slug: true },
    });
    invalidateAdminProductDictionariesCache();
    // Bust Next.js Router Cache. Filesystem path includes `[locale]`
    // dynamic segment, type "page" matches all locales (ru/uz/en).
    revalidatePath("/[locale]/admin/brands", "page");
    revalidatePath("/[locale]/admin/products", "page");
    revalidateTag(TAXONOMY_TAG);
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    throw err;
  }
}
