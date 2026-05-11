/**
 * PATCH  /api/account/addresses/[id]   — частичное обновление.
 * DELETE /api/account/addresses/[id]   — удаление.
 *
 * Ownership: обе операции проверяют, что `address.userId === session.user.id`.
 * Чужие адреса для всех запросов выглядят как `not_found` (404) — чтобы не
 * раскрывать существование чужих записей.
 */

import { prisma } from "@bigmax/db";
import { toE164 } from "@bigmax/shared-types";
import { NextResponse, type NextRequest } from "next/server";

import { AddressUpdateSchema } from "@/account/schemas";
import { auth } from "@/auth";

interface RouteContext {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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

  const parsed = AddressUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const existing = await prisma.address.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const { isDefault, phone, ...rest } = parsed.data;
  const data: {
    region?: string;
    city?: string;
    district?: string | null;
    street?: string | null;
    house?: string | null;
    apartment?: string | null;
    landmark?: string | null;
    phone?: string | null;
    isDefault?: boolean;
  } = {};
  if (rest.region !== undefined) data.region = rest.region;
  if (rest.city !== undefined) data.city = rest.city;
  if (rest.district !== undefined) data.district = rest.district ?? null;
  if (rest.street !== undefined) data.street = rest.street ?? null;
  if (rest.house !== undefined) data.house = rest.house ?? null;
  if (rest.apartment !== undefined) data.apartment = rest.apartment ?? null;
  if (rest.landmark !== undefined) data.landmark = rest.landmark ?? null;
  if (phone !== undefined) data.phone = phone ? toE164(phone) : null;
  if (isDefault !== undefined) data.isDefault = isDefault;

  const address = await prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.address.updateMany({
        where: { userId: session.user.id, isDefault: true, NOT: { id: params.id } },
        data: { isDefault: false },
      });
    }
    return tx.address.update({ where: { id: params.id }, data });
  });

  return NextResponse.json({ ok: true, address });
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await prisma.address.deleteMany({
    where: { id: params.id, userId: session.user.id },
  });
  if (result.count === 0) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
