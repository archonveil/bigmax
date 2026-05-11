/**
 * /api/favorites — CRUD избранного для авторизованного юзера.
 *
 * GET     — список user's favorites со снапшотами для `/favorites` страницы.
 * POST    — добавить `{productId}` (idempotent upsert).
 * DELETE  — удалить `?productId=X` (idempotent).
 *
 * Гость работает только с localStorage (`bigmax:favorites`). Sync guest → user
 * делает `/api/favorites/sync` при логине.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { addFavorite, getFavoritesForUser, removeFavorite } from "@/server/catalog";

const ProductIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/i);

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const items = await getFavoritesForUser(session.user.id);
  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}

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
  const parsed = z.object({ productId: ProductIdSchema }).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }
  const item = await addFavorite(session.user.id, parsed.data.productId);
  if (!item) {
    return NextResponse.json({ ok: false, reason: "product_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const productId = request.nextUrl.searchParams.get("productId");
  const parsed = ProductIdSchema.safeParse(productId);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_productId" }, { status: 400 });
  }
  await removeFavorite(session.user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
