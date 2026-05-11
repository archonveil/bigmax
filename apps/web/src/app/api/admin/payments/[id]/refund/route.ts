/**
 * `POST /api/admin/payments/[id]/refund` (P6-T6, master-prompt §5.9, §8).
 *
 * Admin-only refund (полный или частичный). Тонкий адаптер: Zod →
 * `executeRefund` (общая логика с bulk-endpoint'ом) → HTTP-status mapping.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { RefundCreateSchema } from "@/server/admin-payments";
import { executeRefund } from "@/server/refund-execute";

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
  const parsed = RefundCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { amountCents, reason } = parsed.data;

  const result = await executeRefund({
    paymentId: ctx.params.id,
    amountCents,
    reason,
    adminUserId: auth.userId,
    adminEmail: auth.email,
  });

  switch (result.kind) {
    case "ok":
      return NextResponse.json(
        {
          ok: true,
          refundId: result.refundId,
          unitellerRefundId: result.unitellerRefundId,
          paymentStatus: result.paymentStatus,
          refundableRemaining: result.refundableRemaining,
        },
        { status: 200, headers: { "Cache-Control": "no-store, private" } },
      );
    case "payment_not_found":
      return NextResponse.json({ ok: false, reason: "payment_not_found" }, { status: 404 });
    case "not_refundable":
      return NextResponse.json(
        { ok: false, reason: "not_refundable", paymentStatus: result.paymentStatus },
        { status: 409 },
      );
    case "amount_exceeds_remaining":
      return NextResponse.json(
        { ok: false, reason: "amount_exceeds_remaining", remaining: result.remaining },
        { status: 409 },
      );
    case "provider_misconfigured":
      return NextResponse.json({ ok: false, reason: "provider_misconfigured" }, { status: 503 });
    case "provider_error":
      return NextResponse.json(
        { ok: false, reason: "provider_error", message: result.message },
        { status: 502 },
      );
  }
}
