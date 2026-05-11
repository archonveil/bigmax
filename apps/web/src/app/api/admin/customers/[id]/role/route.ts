/**
 * `PATCH /api/admin/customers/[id]/role` (P6-T8).
 *
 * Меняет `User.role` (customer | manager | admin) с reason для audit'а.
 * Защиты:
 *  - **Self-demote protection**: admin не может понизить себя — иначе
 *    может случайно потерять доступ к админке. 409 `cannot_self_demote`.
 *  - **Manager-only restriction**: только role="admin" может назначать
 *    "admin". role="manager" может назначать только "customer"/"manager"
 *    (через requireAdminSession принимаем оба admin/manager — но при
 *    попытке manager'а назначить admin'а отдаём 403 `forbidden`).
 *
 * Audit: запись в `PaymentLog{action: "user.role_change", request: {oldRole,
 *   newRole, reason, adminId, adminEmail, targetUserId}}`. Используем
 * PaymentLog потому что он already имеет admin-user trail и nullable
 * paymentId — отдельный UserAuditLog можно добавить в P8 если будет need.
 *
 * Response:
 *  - 200 `{ok, id, role}`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 403 forbidden (manager пытается назначить admin)
 *  - 404 user_not_found
 *  - 409 cannot_self_demote / role_unchanged
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { RoleChangeSchema } from "@/server/admin-customers";
import { writePaymentLog } from "@/server/payment-log";

interface RouteContext {
  params: { id: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = RoleChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { role: newRole, reason } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, role: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 404 });
  }

  if (target.id === auth.userId && target.role === "admin" && newRole !== "admin") {
    return NextResponse.json({ ok: false, reason: "cannot_self_demote" }, { status: 409 });
  }
  if (target.role === newRole) {
    return NextResponse.json({ ok: false, reason: "role_unchanged" }, { status: 409 });
  }
  // Manager не может назначать admin'а.
  if (auth.role === "manager" && newRole === "admin") {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { role: newRole },
    select: { id: true },
  });

  await writePaymentLog({
    paymentId: null,
    action: "user.role_change",
    request: {
      targetUserId: target.id,
      targetEmail: target.email,
      oldRole: target.role,
      newRole,
      reason,
      adminId: auth.userId,
      adminEmail: auth.email,
    },
    statusCode: 200,
  });

  return NextResponse.json(
    { ok: true, id: target.id, role: newRole },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
