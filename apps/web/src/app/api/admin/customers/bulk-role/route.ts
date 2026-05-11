/**
 * `POST /api/admin/customers/bulk-role` (P6-T8 follow-up — closes (d)).
 *
 * Bulk role change для до 50 пользователей одним запросом. Per-user
 * проверки те же что в single-route'е:
 *  - cannot_self_demote (если admin понижает себя)
 *  - role_unchanged (idempotency)
 *  - forbidden (manager → admin)
 *  - user_not_found
 *
 * Failures — в `skipped[{userId, reason}]`, не валит весь batch.
 * `processed[]` содержит успешно обновлённые ids. Каждый успех — отдельная
 * `PaymentLog{action: "user.role_change", request: {bulk: true}}` запись.
 */

import { prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { RoleBulkSchema } from "@/server/admin-customers";
import { writePaymentLogs } from "@/server/payment-log";

interface SkippedItem {
  userId: string;
  reason: "user_not_found" | "cannot_self_demote" | "role_unchanged" | "forbidden";
}

export async function POST(req: NextRequest): Promise<Response> {
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
  const parsed = RoleBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { userIds, role: newRole, reason } = parsed.data;
  const uniqueIds = Array.from(new Set(userIds));

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, role: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const processed: string[] = [];
  const skipped: SkippedItem[] = [];
  const toUpdate: Array<{ id: string; oldRole: string; email: string | null }> = [];

  for (const id of uniqueIds) {
    const user = byId.get(id);
    if (!user) {
      skipped.push({ userId: id, reason: "user_not_found" });
      continue;
    }
    if (user.id === auth.userId && user.role === "admin" && newRole !== "admin") {
      skipped.push({ userId: id, reason: "cannot_self_demote" });
      continue;
    }
    if (user.role === newRole) {
      skipped.push({ userId: id, reason: "role_unchanged" });
      continue;
    }
    if (auth.role === "manager" && newRole === "admin") {
      skipped.push({ userId: id, reason: "forbidden" });
      continue;
    }
    toUpdate.push({ id: user.id, oldRole: user.role, email: user.email });
  }

  if (toUpdate.length > 0) {
    // Atomic UPDATE на все ok-records одной операцией.
    await prisma.user.updateMany({
      where: { id: { in: toUpdate.map((u) => u.id) } },
      data: { role: newRole },
    });
    // Per-user audit (best-effort, не throw'ит). Один round-trip вместо N — P0-5.
    await writePaymentLogs(
      toUpdate.map((u) => ({
        paymentId: null,
        action: "user.role_change",
        request: {
          targetUserId: u.id,
          targetEmail: u.email,
          oldRole: u.oldRole,
          newRole,
          reason,
          adminId: auth.userId,
          adminEmail: auth.email,
          bulk: true,
        },
        statusCode: 200,
      })),
    );
    processed.push(...toUpdate.map((u) => u.id));
  }

  return NextResponse.json(
    { ok: true, processed, skipped },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
