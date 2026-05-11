/**
 * POST /api/auth/register
 *
 * Регистрация по email + password. Создаёт `User` с `passwordHash` (bcrypt,
 * 10 rounds), ролью `customer`, языком по умолчанию `ru`. Клиент после
 * успеха делает `signIn("credentials", {...})`.
 *
 * Ответы:
 *   200 { ok: true }
 *   400 { ok: false, reason: "invalid_body" }
 *   409 { ok: false, reason: "email_exists" }
 */

import { prisma } from "@bigmax/db";
import { DEFAULT_LOCALE } from "@bigmax/shared-types";
import { hash } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { RegisterEmailRequestSchema } from "@/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const parsed = RegisterEmailRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ ok: false, reason: "email_exists" }, { status: 409 });
  }

  const passwordHash = await hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "customer",
      language: DEFAULT_LOCALE,
    },
  });

  return NextResponse.json({ ok: true });
}
