/**
 * `POST /api/admin/payments/bulk-refund` (P6-T6 follow-up — closes (d)).
 *
 * Bulk-refund для до 50 платежей одним кликом. Режимы:
 *  - `mode: "full"` — возвращает всю оставшуюся сумму у каждого
 *    платежа (полный refund).
 *  - `mode: "fixed"` + `amountCents` — фиксированная сумма у каждого;
 *    платежи с remaining < amountCents попадают в `skipped[]` с reason
 *    `amount_exceeds_remaining`.
 *
 * Каждый платёж обрабатывается независимо через `executeRefund`. Провалы
 * (not_refundable / payment_not_found / provider_error / ...) не валят
 * весь batch — собираются в `skipped[]`. Order сохраняется как в input'е.
 *
 * **Тайминг**: каждый Uniteller refund — outbound HTTP с 30s timeout. Для
 * 50 платежей worst-case 25 минут. Sequential обработка (не Promise.all)
 * чтобы не ddos'ить Uniteller параллельными запросами и чтобы один
 * stalled refund не блокировал остальные через rate-limit. Если admin'у
 * этого мало — отдельный slot с очередью BullMQ.
 *
 * Response:
 *  - 200 `{ok, processed: [{paymentId, refundId, amountCents, ...}], skipped: [{paymentId, reason}]}`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { RefundBulkSchema } from "@/server/admin-payments";
import { executeRefund, type RefundExecuteResult } from "@/server/refund-execute";

interface ProcessedItem {
  paymentId: string;
  refundId: string;
  unitellerRefundId: string | null;
  amountCents: number;
  paymentStatus: string;
  refundableRemaining: number;
}

interface SkippedItem {
  paymentId: string;
  reason: RefundExecuteResult["kind"];
  message?: string;
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
  const parsed = RefundBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { paymentIds, reason } = parsed.data;
  const fixedAmount = parsed.data.mode === "fixed" ? parsed.data.amountCents : undefined;

  const uniqueIds = Array.from(new Set(paymentIds));
  const processed: ProcessedItem[] = [];
  const skipped: SkippedItem[] = [];

  // Sequential — не Promise.all, чтобы не уронить Uniteller rate-limit'ом и
  // чтобы один stalled-call не блокировал остальные.
  for (const paymentId of uniqueIds) {
    const result = await executeRefund({
      paymentId,
      ...(fixedAmount !== undefined ? { amountCents: fixedAmount } : {}),
      reason,
      adminUserId: auth.userId,
      adminEmail: auth.email,
    });
    if (result.kind === "ok") {
      processed.push({
        paymentId,
        refundId: result.refundId,
        unitellerRefundId: result.unitellerRefundId,
        amountCents: result.amountCents,
        paymentStatus: result.paymentStatus,
        refundableRemaining: result.refundableRemaining,
      });
    } else {
      skipped.push({
        paymentId,
        reason: result.kind,
        ...("message" in result ? { message: result.message } : {}),
      });
    }
  }

  return NextResponse.json(
    { ok: true, processed, skipped },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
