import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { CategoryCreateSchema, prismaErrorCode } from "@/server/admin-taxonomy";
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
  const parsed = CategoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;
  try {
    const created = await prisma.category.create({
      data: {
        nameRu: data.nameRu,
        nameUz: data.nameUz ?? "",
        nameEn: data.nameEn ?? "",
        slug: data.slug,
        parentId: data.parentId ?? null,
        iconUrl: data.iconUrl ?? null,
        order: data.order,
        isActive: data.isActive,
      },
      select: { id: true, slug: true },
    });
    invalidateAdminProductDictionariesCache();
    revalidatePath("/[locale]/admin/categories", "page");
    revalidatePath("/[locale]/admin/products", "page");
    revalidateTag(TAXONOMY_TAG);
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
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
