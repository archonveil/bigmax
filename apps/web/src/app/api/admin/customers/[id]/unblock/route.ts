/**
 * `POST /api/admin/customers/[id]/unblock` (P6-T8 follow-up — closes (a)).
 * Снимает `User.isBlocked`. 409 если уже не заблокирован (idempotency).
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { BlockToggleSchema } from "@/server/admin-customers";
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
  const parsed = BlockToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { reason } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, isBlocked: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 404 });
  }
  if (!target.isBlocked) {
    return NextResponse.json({ ok: false, reason: "not_blocked" }, { status: 409 });
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { isBlocked: false },
    select: { id: true },
  });

  await writePaymentLog({
    paymentId: null,
    action: "user.unblocked",
    request: {
      targetUserId: target.id,
      targetEmail: target.email,
      reason,
      adminId: auth.userId,
      adminEmail: auth.email,
    },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, id: target.id, isBlocked: false },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
