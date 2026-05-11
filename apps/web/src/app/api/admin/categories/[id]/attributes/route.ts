/**
 * `POST /api/admin/categories/[id]/attributes` — create new attribute config
 * for a category.
 *
 * Auth: admin/manager. Body: `CategoryAttributeCreateSchema`.
 * Conflicts:
 *  - duplicate key per category → 409 `key_exists`.
 *  - неизвестная category → 400 `category_not_found`.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import {
  CategoryAttributeCreateSchema,
  createCategoryAttribute,
} from "@/server/admin-category-attributes";
import { ATTRIBUTES_TAG } from "@/server/category-attributes";

interface Ctx {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
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

  const parsed = CategoryAttributeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const result = await createCategoryAttribute(ctx.params.id, parsed.data);
  if (!result.ok) {
    if (result.reason === "category_not_found") {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
    }
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
  }
  // Bust Next.js Router Cache. Filesystem-style paths: `[locale]` matches
  // all locales, `[id]` matches all categories.
  revalidatePath("/[locale]/admin/categories/[id]/attributes", "page");
  revalidatePath("/[locale]/admin/categories/[id]", "page");
  revalidatePath("/[locale]/admin/products/[id]", "page");
  revalidatePath("/[locale]/admin/products", "page");
  // P1-16: ломаем `unstable_cache(getAllAttributeKeys)` storefront-стороны.
  revalidateTag(ATTRIBUTES_TAG);
  return NextResponse.json(
    { ok: true, id: result.id },
    { status: 201, headers: { "Cache-Control": "no-store, private" } },
  );
}
