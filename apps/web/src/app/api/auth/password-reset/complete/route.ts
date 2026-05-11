/**
 * `POST /api/auth/password-reset/complete` (P6-T8 follow-up — closes (b)).
 *
 * Customer кликает по ссылке из email, вводит новый пароль, мы валидируем
 * token + bcrypt-hash + expiry + usedAt, обновляем `User.passwordHash`,
 * помечаем token usedAt — atomic transaction.
 *
 * Защиты:
 *  - Token формат — Zod (`tokenId.plain` → `parseCompoundToken`)
 *  - Brute-force на token — rate-limit на IP (10 req/15min, attacker не
 *    сможет brute'ить 256-bit token за разумное время даже без лимита,
 *    но защищаем от resource-exhaustion'а от bcrypt-compare'ов)
 *  - One-shot: `usedAt` ставится в той же транзакции что и `passwordHash` —
 *    защита от race-condition replay'а.
 *  - Blocked users — не позволяем reset'ить (после reset они всё равно
 *    не залогинятся через NextAuth, но безопаснее не трогать password)
 *
 * Audit: PaymentLog `auth.password_reset_completed`.
 */

import { prisma } from "@bigmax/db";
import { hash } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { reportError } from "@/server/observability";
import { lookupResetToken, PasswordResetCompleteSchema } from "@/server/password-reset";
import { writePaymentLog } from "@/server/payment-log";
import { enforceRateLimit } from "@/server/rate-limit";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  return real ?? "unknown";
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = PasswordResetCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { token, password } = parsed.data;

  // Anti-bruteforce на bcrypt-compare.
  const ip = clientIp(req);
  const limit = await enforceRateLimit({
    key: `pwd-reset-complete:ip:${ip}`,
    limit: 10,
    windowSec: 900,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const lookup = await lookupResetToken(token);
  if (lookup.kind !== "ok") {
    // Маппим discriminated kind → понятный reason для UI.
    const reasonMap: Record<Exclude<typeof lookup.kind, "ok">, string> = {
      not_found: "tokenInvalid",
      invalid_format: "tokenInvalid",
      expired: "tokenExpired",
      already_used: "tokenAlreadyUsed",
    };
    return NextResponse.json({ ok: false, reason: reasonMap[lookup.kind] }, { status: 400 });
  }

  // Verify user existence + не заблокирован.
  const user = await prisma.user.findUnique({
    where: { id: lookup.userId },
    select: { id: true, isBlocked: true, email: true },
  });
  if (!user || user.isBlocked) {
    return NextResponse.json({ ok: false, reason: "tokenInvalid" }, { status: 400 });
  }

  try {
    const newHash = await hash(password, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
        select: { id: true },
      });
      await tx.passwordResetToken.update({
        where: { id: lookup.tokenId },
        data: { usedAt: new Date() },
        select: { id: true },
      });
    });

    await writePaymentLog({
      paymentId: null,
      action: "auth.password_reset_completed",
      request: { userId: user.id, email: user.email, ip },
      statusCode: 200,
    });

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      scope: "web.auth.password-reset.complete",
      extra: { userId: user.id },
    });
    return NextResponse.json({ ok: false, reason: "generic" }, { status: 500 });
  }
}
