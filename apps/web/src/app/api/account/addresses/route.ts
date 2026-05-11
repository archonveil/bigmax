/**
 * GET  /api/account/addresses   — список адресов текущего пользователя.
 * POST /api/account/addresses   — создание нового адреса.
 *
 * Правила:
 *   - Лимит MAX_ADDRESSES_PER_USER = 10.
 *   - Если `isDefault: true` — сбрасываем флаг у остальных адресов юзера
 *     атомарно в одной транзакции.
 *   - `phone` нормализуется в E.164 через `toE164` (или стирается, если
 *     не парсится — но schema Zod уже валидирует формат).
 *
 * Ответы POST:
 *   201 { ok: true, address }
 *   400 { ok: false, reason: "invalid_body" }
 *   401 { ok: false, reason: "unauthorized" }
 *   422 { ok: false, reason: "limit_reached" }
 */

import { prisma } from "@bigmax/db";
import { MAX_ADDRESSES_PER_USER, toE164 } from "@bigmax/shared-types";
import { NextResponse, type NextRequest } from "next/server";

import { AddressCreateSchema } from "@/account/schemas";
import { auth } from "@/auth";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const addresses = await prisma.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ ok: true, addresses });
}

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

  const parsed = AddressCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const count = await prisma.address.count({ where: { userId: session.user.id } });
  if (count >= MAX_ADDRESSES_PER_USER) {
    return NextResponse.json(
      { ok: false, reason: "limit_reached", limit: MAX_ADDRESSES_PER_USER },
      { status: 422 },
    );
  }

  const { isDefault, phone, ...rest } = parsed.data;
  const normalizedPhone = phone ? toE164(phone) : null;

  const address = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.address.updateMany({
        where: { userId: session.user.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: {
        userId: session.user.id,
        region: rest.region,
        city: rest.city,
        district: rest.district ?? null,
        street: rest.street ?? null,
        house: rest.house ?? null,
        apartment: rest.apartment ?? null,
        landmark: rest.landmark ?? null,
        phone: normalizedPhone,
        isDefault: isDefault ?? false,
      },
    });
  });

  return NextResponse.json({ ok: true, address }, { status: 201 });
}
