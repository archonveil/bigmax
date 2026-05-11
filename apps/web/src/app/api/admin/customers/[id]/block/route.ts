/**
 * `POST /api/admin/customers/[id]/block` (P6-T8 follow-up — closes (a)).
 *
 * Помечает `User.isBlocked = true`. Defensive guards:
 *  - admin не может заблокировать самого себя (cannot_self_block) → 409
 *  - manager не может блокировать admin'ов (forbidden) → 403
 *  - already-blocked → 409 (idempotency)
 *
 * Audit: PaymentLog{action: "user.blocked", request: {targetUserId, reason,
 *   adminId, adminEmail}}.
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
    select: { id: true, isBlocked: true, role: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 404 });
  }
  if (target.id === auth.userId) {
    return NextResponse.json({ ok: false, reason: "cannot_self_block" }, { status: 409 });
  }
  if (target.isBlocked) {
    return NextResponse.json({ ok: false, reason: "already_blocked" }, { status: 409 });
  }
  if (auth.role === "manager" && target.role === "admin") {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { isBlocked: true },
    select: { id: true },
  });

  await writePaymentLog({
    paymentId: null,
    action: "user.blocked",
    request: {
      targetUserId: target.id,
      targetEmail: target.email,
      targetRole: target.role,
      reason,
      adminId: auth.userId,
      adminEmail: auth.email,
    },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, id: target.id, isBlocked: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
