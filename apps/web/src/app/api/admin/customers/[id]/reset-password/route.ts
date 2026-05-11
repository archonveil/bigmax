/**
 * `POST /api/admin/customers/[id]/reset-password` (P6-T8).
 *
 * Генерирует временный 12-символьный пароль из safe alphabet (без I/l/1/O/0)
 * для admin-driven password reset. Сценарий: клиент звонит в support,
 * подтверждает identity, admin сбрасывает пароль и диктует новый.
 *
 * Возвращается plain-text password **один раз** в response → admin
 * передаёт клиенту через защищённый канал (звонок/SMS/email из доверенного
 * device'а). В БД хранится только bcrypt-hash.
 *
 * Audit: PaymentLog{action: "user.password_reset", request: {targetUserId,
 *   adminId, reason}, response: NEVER plain-password}.
 *
 * Response:
 *  - 200 `{ok, temporaryPassword}` — plain-text 12 chars
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 404 user_not_found
 *  - 409 user_has_no_password (OTP-only user — нечего ресетить)
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { PasswordResetSchema, generateTempPassword, hashPassword } from "@/server/admin-customers";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = PasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { reason } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 404 });
  }
  if (!target.passwordHash) {
    // OTP-only пользователь (вошёл через phone) — пароля никогда не было.
    // Reset через generate temp pass всё равно работает (создаст new hash),
    // но admin должен явно подтвердить — пока возвращаем 409 как защиту.
    return NextResponse.json({ ok: false, reason: "user_has_no_password" }, { status: 409 });
  }

  const temporaryPassword = generateTempPassword(12);
  const newHash = await hashPassword(temporaryPassword);

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: newHash },
    select: { id: true },
  });

  await writePaymentLog({
    paymentId: null,
    action: "user.password_reset",
    request: {
      targetUserId: target.id,
      targetEmail: target.email,
      adminId: auth.userId,
      adminEmail: auth.email,
      reason,
    },
    // НИКОГДА не пишем plain-password в audit. Только flag успеха.
    response: { ok: true },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, temporaryPassword },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
