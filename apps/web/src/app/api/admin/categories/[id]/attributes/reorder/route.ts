/**
 * `PATCH /api/admin/categories/[id]/attributes/reorder` — bulk reorder.
 * Body: `{ orderedIds: string[] }` — id'ы в нужном порядке.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import {
  CategoryAttributeReorderSchema,
  reorderCategoryAttributes,
} from "@/server/admin-category-attributes";

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
  const parsed = CategoryAttributeReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const result = await reorderCategoryAttributes(ctx.params.id, parsed.data.orderedIds);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, updated: result.updated },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
