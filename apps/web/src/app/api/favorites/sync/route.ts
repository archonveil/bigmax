/**
 * POST /api/favorites/sync
 *
 * Merge-sync гостевого localStorage-списка с серверной `Favorite` таблицей
 * авторизованного юзера. Body — `{ productIds: string[] }`. Server делает
 * upsert всех id (skipDuplicates) и возвращает финальный список со снапшотами
 * для замены клиентского store (setItems).
 *
 * Вызывается клиентом через `useFavoritesSync` при обнаружении session.user.id
 * (переход guest→user после логина).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { syncFavorites } from "@/server/catalog";

const SyncBodySchema = z.object({
  productIds: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9]+$/i),
    )
    .max(200), // sane upper bound для прод-реальности
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const parsed = SyncBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  // Дедуп productIds клиентская сторона обязана делать, но мы дополнительно
  // защищаемся через Set.
  const uniqueIds = Array.from(new Set(parsed.data.productIds));
  const items = await syncFavorites(session.user.id, uniqueIds);

  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}
