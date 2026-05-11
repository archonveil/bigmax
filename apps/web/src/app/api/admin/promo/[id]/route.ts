/**
 * `PATCH /api/admin/promo/[id]` — partial update.
 * `DELETE /api/admin/promo/[id]` — hard-delete.
 *
 * Hard-delete безопасен: `Order.promoCode` — denormalized String snapshot,
 * не FK. Audit-след в заказах сохранится.
 */

import { prisma } from "@bigmax/db";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { PromoUpdateSchema, prismaErrorCode } from "@/server/admin-promo";
import { invalidatePromoCacheByCode } from "@/server/promo";

interface Ctx {
  params: { id: string };
}

function bustPromoCaches(): void {
  revalidatePath("/[locale]/admin/promo", "page");
  revalidatePath("/[locale]/admin/promo/[id]", "page");
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
  const parsed = PromoUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const exists = await prisma.promo.findUnique({
    where: { id: ctx.params.id },
    // P7-T1 sub-task B: тащим старый `code` чтобы инвалидировать его кэш
    // при смене на новый (иначе old-code останется в Redis до TTL).
    select: { id: true, code: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const d = parsed.data;
  try {
    const updated = await prisma.promo.update({
      where: { id: ctx.params.id },
      data: {
        ...(d.code !== undefined ? { code: d.code } : {}),
        ...(d.type !== undefined ? { type: d.type } : {}),
        ...(d.value !== undefined ? { value: d.value } : {}),
        ...(d.minOrderCents !== undefined ? { minOrderCents: d.minOrderCents } : {}),
        // `startsAt`/`endsAt` приходят как `Date | null` после Zod-transform;
        // `undefined` означает «не менять», `null` — «очистить дату».
        ...(d.startsAt !== undefined ? { startsAt: d.startsAt } : {}),
        ...(d.endsAt !== undefined ? { endsAt: d.endsAt } : {}),
        ...(d.usageLimit !== undefined ? { usageLimit: d.usageLimit } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
      select: { id: true, code: true },
    });
    bustPromoCaches();
    // P7-T1 sub-task B: bust Redis для старого и нового кода (если код менялся).
    await invalidatePromoCacheByCode(exists.code);
    if (updated.code !== exists.code) {
      await invalidatePromoCacheByCode(updated.code);
    }
    return NextResponse.json({ ok: true, ...updated }, { status: 200 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "code_exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const exists = await prisma.promo.findUnique({
    where: { id: ctx.params.id },
    // P7-T1 sub-task B: тащим `code` чтобы инвалидировать кэш после delete.
    select: { id: true, code: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  await prisma.promo.delete({ where: { id: ctx.params.id }, select: { id: true } });
  bustPromoCaches();
  await invalidatePromoCacheByCode(exists.code);
  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}
