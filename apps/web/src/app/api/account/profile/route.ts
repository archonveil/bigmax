/**
 * PATCH /api/account/profile
 *
 * Частичное обновление профиля текущего пользователя: name, language, email.
 * Email устанавливается только если в БД он `null` (смена подтверждённого
 * email требует верификации — отложено до P4-T10). Возвращает свежую
 * «публичную» модель user для клиента.
 *
 *   200 { ok: true, user: { id, name, language, email, phone, role } }
 *   400 { ok: false, reason: "invalid_body" }
 *   401 { ok: false, reason: "unauthorized" }
 *   409 { ok: false, reason: "email_locked" | "email_exists" }
 */

import { Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { auth, ProfileUpdateSchema } from "@/auth";

export async function PATCH(request: NextRequest): Promise<NextResponse> {
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

  const parsed = ProfileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!current) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const data: Prisma.UserUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.language !== undefined) data.language = parsed.data.language;
  if (parsed.data.email !== undefined) {
    if (current.email !== null && current.email !== parsed.data.email) {
      return NextResponse.json({ ok: false, reason: "email_locked" }, { status: 409 });
    }
    data.email = parsed.data.email;
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        language: true,
      },
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ ok: false, reason: "email_exists" }, { status: 409 });
    }
    throw err;
  }
}
