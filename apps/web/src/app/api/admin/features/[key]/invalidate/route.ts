/**
 * P7-T2 sub-task I: explicit cache invalidation endpoint.
 *
 * Когда admin меняет row через прямой SQL UPDATE (out-of-band) — cache
 * не сбрасывается автоматически (PATCH-flow дёргает invalidate сам, но
 * прямой SQL — нет). Этот endpoint даёт безопасный способ через UI
 * дёрнуть `invalidateFeatureCache(key)` без изменения row.
 *
 * Также полезно для отладки stale-cache подозрений.
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { canChangeFeature } from "@/lib/feature-permissions";
import { requireAdminSession } from "@/server/admin-auth";
import { invalidateFeatureCache } from "@/server/features";
import { writePaymentLog } from "@/server/payment-log";

interface Ctx {
  params: { key: string };
}

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // FF-011: per-flag role gate (та же policy что у PATCH — кэш busts —
  // тоже mutation с production-impact для money-flags).
  if (!canChangeFeature(auth.role, ctx.params.key)) {
    return NextResponse.json({ ok: false, reason: "forbidden_for_role" }, { status: 403 });
  }

  const exists = await prisma.feature.findUnique({
    where: { key: ctx.params.key },
    select: { key: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  await invalidateFeatureCache(ctx.params.key);

  // P7-T2 sub-task K: audit-log для out-of-band cache busts. Полезно при
  // расследовании «почему feature не подхватилась» — видим кто и когда дёргал.
  await writePaymentLog({
    paymentId: null,
    action: "feature.cache_invalidated",
    request: { key: ctx.params.key, adminId: auth.userId, adminEmail: auth.email },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, invalidated: ctx.params.key },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
