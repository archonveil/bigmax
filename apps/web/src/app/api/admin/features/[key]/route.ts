/**
 * P7-T2 sub-task G+I: admin features API.
 *
 *  - `PATCH /api/admin/features/[key]` — обновить `value`, провалидировав
 *    против `type` row'ы. Атомарно дёргает `invalidateFeatureCache(key)` —
 *    новое значение становится видимым сразу (без 60s TTL-ожидания).
 *  - `POST /api/admin/features/[key]/invalidate` — explicit cache bust
 *    без изменения row'ы (для случаев out-of-band updates через прямой SQL).
 *
 * Hard-coded NO `POST`/`DELETE` для самой row'ы — features добавляются
 * через миграции (см. server/admin-features.ts комментарий).
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { canChangeFeature } from "@/lib/feature-permissions";
import { requireAdminSession } from "@/server/admin-auth";
import { FeatureValueUpdateSchema, validateFeatureValue } from "@/server/admin-features";
import { invalidateFeatureCache } from "@/server/features";
import { writePaymentLog } from "@/server/payment-log";

interface Ctx {
  params: { key: string };
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // FF-011: per-flag role gate. Defense-in-depth — UI прячет controls,
  // но защищаемся и здесь от прямых API-вызовов.
  if (!canChangeFeature(auth.role, ctx.params.key)) {
    return NextResponse.json({ ok: false, reason: "forbidden_for_role" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = FeatureValueUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const existing = await prisma.feature.findUnique({
    where: { key: ctx.params.key },
    // P7-T2 sub-task K: тащим прежний value чтобы записать в audit-log.
    select: { type: true, value: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const valueCheck = validateFeatureValue(existing.type, parsed.data.value);
  if (!valueCheck.ok) {
    return NextResponse.json({ ok: false, reason: valueCheck.reason }, { status: 400 });
  }

  const updated = await prisma.feature.update({
    where: { key: ctx.params.key },
    data: { value: parsed.data.value },
    select: { key: true, value: true, type: true, updatedAt: true },
  });

  // P7-T2 sub-task I: после изменения row'ы инвалидируем cache — новое
  // значение видно немедленно, не дожидаясь 60s TTL.
  await invalidateFeatureCache(ctx.params.key);

  // P7-T2 sub-task K: audit-log. PaymentLog — это унифицированный admin-audit
  // store (см. /admin/audit page «Все админ-операции в одной timeline»).
  // No-op friendly: запись с `paymentId: null` — admin-операция без привязки
  // к платежу. Best-effort: не валим запрос если PaymentLog недоступен.
  await writePaymentLog({
    paymentId: null,
    action: "feature.updated",
    request: {
      key: ctx.params.key,
      oldValue: existing.value,
      newValue: updated.value,
      adminId: auth.userId,
      adminEmail: auth.email,
    },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, ...updated },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
