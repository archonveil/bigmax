/**
 * `writePaymentLog` — best-effort запись `PaymentLog` (P4-T11).
 *
 * Используется webhook'ом Uniteller, `/api/checkout/pay` route'ом, и
 * worker'ом (через свой аналог) — единая точка для:
 *   - **PAN-маскирования** (`scrubPaymentPayload` из `@bigmax/payments`):
 *     любые 13-19 digit подпоследовательности → `**** **** **** 1234`,
 *     секретные ключи (password, Signature, *_token, ...) → `[REDACTED]`.
 *   - **Best-effort семантики**: ошибка БД при логировании НЕ должна
 *     валить webhook/route. PaymentLog — audit trail, не критичный путь.
 *
 * Не throw'ит. На ошибке только пишет в Sentry (через `reportError`
 * после P4-T11.5) или silently swallow.
 */

import { Prisma, prisma } from "@bigmax/db";
import { uniteller } from "@bigmax/payments";

import { reportError } from "./observability";

export interface PaymentLogInput {
  paymentId?: string | null;
  action: string;
  request?: unknown;
  response?: unknown;
  statusCode?: number;
  errorMessage?: string;
}

export async function writePaymentLog(input: PaymentLogInput): Promise<void> {
  try {
    await prisma.paymentLog.create({ data: buildPaymentLogData(input) });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      scope: "web.payment-log",
      extra: { action: input.action, paymentId: input.paymentId ?? null },
    });
  }
}

/**
 * Bulk-вариант для admin-routes (P0-5): один round-trip вместо N.
 * Best-effort, как и single-version: ошибка не валит caller'а.
 */
export async function writePaymentLogs(inputs: PaymentLogInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await prisma.paymentLog.createMany({
      data: inputs.map(buildPaymentLogData),
    });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      scope: "web.payment-log.bulk",
      extra: { count: inputs.length, action: inputs[0]?.action },
    });
  }
}

function buildPaymentLogData(input: PaymentLogInput): Prisma.PaymentLogUncheckedCreateInput {
  const data: Prisma.PaymentLogUncheckedCreateInput = {
    action: input.action,
  };
  if (input.paymentId !== undefined && input.paymentId !== null) {
    data.paymentId = input.paymentId;
  }
  if (input.request !== undefined) {
    data.request = uniteller.scrubPaymentPayload(input.request) as Prisma.InputJsonValue;
  }
  if (input.response !== undefined) {
    data.response = uniteller.scrubPaymentPayload(input.response) as Prisma.InputJsonValue;
  }
  if (input.statusCode !== undefined) data.statusCode = input.statusCode;
  if (input.errorMessage !== undefined) data.errorMessage = input.errorMessage;
  return data;
}
