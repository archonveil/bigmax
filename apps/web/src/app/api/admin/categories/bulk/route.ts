/**
 * `POST /api/admin/categories/bulk` (P6-T4 follow-up).
 *
 * Bulk-операции для категорий: deactivate / activate. Список id'шников
 * (max 200) + action. Возвращает `{ok, updated}` — фактическое количество
 * затронутых строк (Prisma `updateMany.count`).
 */

import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { TAXONOMY_TAG } from "@/server/catalog";

const BulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "ids_empty").max(200, "too_many_ids"),
    action: z.enum(["deactivate", "activate"]),
  })
  .strict();

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
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { ids, action } = parsed.data;
  const result = await prisma.category.updateMany({
    where: { id: { in: ids } },
    data: { isActive: action === "activate" },
  });
  invalidateAdminProductDictionariesCache();
  revalidatePath("/[locale]/admin/categories", "page");
  revalidatePath("/[locale]/admin/products", "page");
  revalidateTag(TAXONOMY_TAG);
  return NextResponse.json(
    { ok: true, updated: result.count, action },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
