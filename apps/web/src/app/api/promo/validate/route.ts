/**
 * GET /api/promo/validate?code=XXX
 *
 * Валидирует промокод: existence, is_active, startsAt..endsAt, usageLimit.
 * minOrderCents не проверяем здесь — клиент применяет промо после валидации
 * и сам считает discount; minOrder UX-проверка на клиенте.
 *
 * Публичный endpoint (без auth) — промо применяются и гостями.
 *
 * P7-T1 sub-task B: lookup идёт через Redis-cache (`getCachedPromoByCode`)
 * с 60s TTL; admin CRUD инвалидирует ключ через `invalidatePromoCacheByCode`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { AppliedPromo } from "@/cart/promo";
import { getCachedPromoByCode } from "@/server/promo";

const CodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9_-]+$/i)
  .transform((s) => s.toUpperCase());

type PromoErrorCode = "invalid" | "expired" | "usageLimitReached";

interface ValidResponse {
  ok: true;
  promo: AppliedPromo;
}
interface InvalidResponse {
  ok: false;
  error: PromoErrorCode;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ValidResponse | InvalidResponse>> {
  const parsed = CodeSchema.safeParse(request.nextUrl.searchParams.get("code"));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const code = parsed.data;

  const promo = await getCachedPromoByCode(code);

  if (!promo || !promo.isActive) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 404 });
  }

  const now = new Date();
  if ((promo.startsAt && promo.startsAt > now) || (promo.endsAt && promo.endsAt < now)) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  }
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return NextResponse.json({ ok: false, error: "usageLimitReached" }, { status: 410 });
  }

  return NextResponse.json(
    {
      ok: true,
      promo: {
        code: promo.code,
        type: promo.type,
        value: promo.value,
        minOrderCents: promo.minOrderCents,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
