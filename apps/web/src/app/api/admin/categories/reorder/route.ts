/**
 * `POST /api/admin/categories/reorder` (P6-T4 follow-up).
 *
 * Принимает массив `{id, order}`-пар (max 500) и атомарно обновляет `order`
 * через `prisma.$transaction`. Каждый id — отдельный update; если id'шник
 * не существует, Prisma вернёт P2025 — пропускаем (skipped[]). Используется
 * drag-and-drop reorder UI'ём.
 */

import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/server/admin-auth";
import { invalidateAdminProductDictionariesCache } from "@/server/admin-products";
import { prismaErrorCode } from "@/server/admin-taxonomy";
import { TAXONOMY_TAG } from "@/server/catalog";

const ReorderSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          order: z.number().int().min(0).max(9999),
        }),
      )
      .min(1)
      .max(500),
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
  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const items = parsed.data.items;

  // $transaction array — все updates атомарны. Если хоть один id отсутствует
  // → P2025 → весь tx откатывается. Это правильное поведение: drag-drop
  // должен либо применить всю перестановку, либо ничего.
  try {
    await prisma.$transaction(
      items.map((it) =>
        prisma.category.update({
          where: { id: it.id },
          data: { order: it.order },
          select: { id: true },
        }),
      ),
    );
    invalidateAdminProductDictionariesCache();
    revalidatePath("/[locale]/admin/categories", "page");
    revalidateTag(TAXONOMY_TAG);
    return NextResponse.json(
      { ok: true, updated: items.length },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
