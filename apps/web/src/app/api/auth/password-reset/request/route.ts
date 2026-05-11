/**
 * `POST /api/auth/password-reset/request` (P6-T8 follow-up — closes (b)).
 *
 * Self-service request: customer вводит email → server создаёт token,
 * отправляет email со ссылкой. Защиты:
 *  - **Email enumeration**: одинаковый response для known/unknown email
 *    (200 ok = link sent ИЛИ no-op-tactical-silence).
 *  - **Rate-limit**: 5 req/15min на IP + 3 req/15min на email — баланс
 *    между UX и spam'ом.
 *  - **Blocked users**: пропускаем silently (не создаём token, response
 *    тот же — не раскрываем что user заблокирован).
 *  - **OTP-only users (без passwordHash)**: тоже silently no-op — для них
 *    логичнее flow через OTP, не через password.
 *
 * **PaymentLog audit**: пишем `auth.password_reset_requested` с
 * `{email, userExists, sent}` (без token!) — admin может видеть в audit
 * логе кто запрашивал что (и поймать spam).
 */

import { prisma } from "@bigmax/db";
import { buildPasswordResetEmail, getResendClient } from "@bigmax/notifications";
import { NextResponse, type NextRequest } from "next/server";

import { absoluteUrl } from "@/seo/config";
import { reportError } from "@/server/observability";
import { createResetToken, PasswordResetRequestSchema } from "@/server/password-reset";
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
  const parsed = PasswordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const email = parsed.data.email;

  // Rate limits: IP + per-email. IP — anti-distributed-spam, email —
  // anti-flooding-конкретного-юзера. Оба окна 15 мин.
  const ip = clientIp(req);
  const ipLimit = await enforceRateLimit({
    key: `pwd-reset:ip:${ip}`,
    limit: 5,
    windowSec: 900,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }
  const emailLimit = await enforceRateLimit({
    key: `pwd-reset:email:${email}`,
    limit: 3,
    windowSec: 900,
  });
  if (!emailLimit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSec) } },
    );
  }

  // Locale из URL запроса (для email на родном языке).
  const referer = req.headers.get("referer") ?? "";
  const localeMatch = /\/(ru|uz|en)\b/.exec(referer);
  const locale = localeMatch?.[1] ?? "ru";

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, language: true, passwordHash: true, isBlocked: true },
  });

  // Tactical silence — same response shape независимо от существования user'а.
  const okResponse = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );

  if (!user || user.isBlocked || !user.passwordHash) {
    await writePaymentLog({
      paymentId: null,
      action: "auth.password_reset_requested",
      request: {
        email,
        ip,
        sent: false,
        reason: !user ? "user_not_found" : user.isBlocked ? "blocked" : "no_password",
      },
      statusCode: 200,
    });
    return okResponse;
  }

  // Создаём token + отправляем email.
  try {
    const compoundToken = await createResetToken(user.id);
    const resetPath = `/${user.language}/auth/password-reset/${compoundToken}`;
    const resetUrl = absoluteUrl(resetPath, user.language);
    const emailContent = await buildPasswordResetEmail({
      rawLocale: user.language,
      email: user.email!,
      resetUrl,
    });
    const resend = getResendClient();
    await resend.sendEmail({
      to: user.email!,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    await writePaymentLog({
      paymentId: null,
      action: "auth.password_reset_requested",
      // Внимание: НЕ пишем token в audit — только метаданные.
      request: { email, ip, sent: true, locale: user.language },
      statusCode: 200,
    });
    void locale; // referer-locale не используется т.к. предпочитаем user.language
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      scope: "web.auth.password-reset.request",
      extra: { email },
    });
    // Tactical silence: даже если email не отправился, отдаём 200 чтобы не
    // раскрывать internal-проблемы. Sentry поймает.
  }

  return okResponse;
}
