/**
 * POST /api/account/password
 *
 * Смена / установка пароля.
 *   - Если у пользователя уже есть `passwordHash` — требуется `currentPassword`.
 *   - Если `passwordHash` отсутствует (phone-only аккаунт) — устанавливаем
 *     первый пароль без сверки старого.
 *
 *   200 { ok: true }
 *   400 { ok: false, reason: "invalid_body" | "current_required" }
 *   401 { ok: false, reason: "unauthorized" | "wrong_current" }
 */

import { prisma } from "@bigmax/db";
import { compare, hash } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { auth, PasswordChangeSchema } from "@/auth";

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

  const parsed = PasswordChangeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  if (user.passwordHash !== null) {
    if (!parsed.data.currentPassword) {
      return NextResponse.json({ ok: false, reason: "current_required" }, { status: 400 });
    }
    const ok = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ ok: false, reason: "wrong_current" }, { status: 401 });
    }
  }

  const newHash = await hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}
