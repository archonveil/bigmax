/**
 * `PATCH /api/admin/categories/[id]/attributes/[attrId]` — update.
 * `DELETE /api/admin/categories/[id]/attributes/[attrId]` — hard-delete.
 *
 * Удаление каскадит — Product.attributes JSON остаётся как есть, ключ
 * становится "unknown". `validateAttributes` silent-ignores unknown keys,
 * так что ничего не ломается; admin может почистить вручную или мы
 * опционально добавим миграцию-cleanup'а позже.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import {
  CategoryAttributeUpdateSchema,
  deleteCategoryAttribute,
  updateCategoryAttribute,
} from "@/server/admin-category-attributes";
import { ATTRIBUTES_TAG } from "@/server/category-attributes";

function bustAttributeCaches(categoryId: string): void {
  // Filesystem-style paths with `[locale]` / `[id]` segments to match all
  // locales and all categories. `categoryId` parameter intentionally unused —
  // the wildcard matches it.
  void categoryId;
  revalidatePath("/[locale]/admin/categories/[id]/attributes", "page");
  revalidatePath("/[locale]/admin/categories/[id]/attributes/[attrId]", "page");
  revalidatePath("/[locale]/admin/categories/[id]", "page");
  revalidatePath("/[locale]/admin/products/[id]", "page");
  revalidatePath("/[locale]/admin/products", "page");
  // P1-16: ломаем `unstable_cache(getAllAttributeKeys)`.
  revalidateTag(ATTRIBUTES_TAG);
}

interface Ctx {
  params: { id: string; attrId: string };
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

  const parsed = CategoryAttributeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const result = await updateCategoryAttribute(ctx.params.attrId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
  }
  bustAttributeCaches(ctx.params.id);
  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;
  const result = await deleteCategoryAttribute(ctx.params.attrId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
  }
  bustAttributeCaches(ctx.params.id);
  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}
