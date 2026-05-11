/**
 * `POST /api/webhooks/uniteller` — обработка callback'а от Uniteller (P4-T6).
 *
 * Поток (§5.7 master-prompt):
 *   1. Rate-limit 100 req/min/IP — защита от bot-flood.
 *   2. Парсинг `application/x-www-form-urlencoded` тела.
 *   3. `evaluateCallback`: Zod + `verifyCallbackSignature`.
 *      - invalid_payload → 400.
 *      - invalid_signature → 401 + PaymentLog (потенциальная атака).
 *   4. Идемпотентность через `WebhookEvent (provider, externalId, signature)`
 *      unique. Если уже processed=true → 200 без побочек.
 *   5. Поиск `Payment` по `unitellerOrderIdp = Order_ID`. Если не найден —
 *      «чужая транзакция»: WebhookEvent.processed=true + 200 + log.
 *   6. В транзакции:
 *      - Update `Payment.status / unitellerBillnumber / unitellerResponseCode /
 *        unitellerCardMask / capturedAt`.
 *      - Если новый status = `captured` → `Order.status = "confirmed"`.
 *      - Mark `WebhookEvent.processed = true`.
 *      - PaymentLog action="webhook".
 *   7. **TODO P4-T10**: enqueue `NotificationJob` (Telegram + SMS + email)
 *      на `captured`/`failed` событиях через BullMQ. Сейчас не делаем.
 *
 * Ответы:
 *   - 200 — happy path, foreign tx, или уже-processed дубль.
 *   - 400 — Zod-fail (плохое тело).
 *   - 401 — invalid signature (Uniteller не должен слать такое в prod).
 *   - 429 — rate-limited.
 *   - 500 — необработанный exception → Uniteller сделает retry.
 *
 * Безопасность: маскирование PAN при логировании — формат уже маскирован
 * Uniteller'ом (`4000 **** **** 2487`), здесь дополнительно ничего не делаем.
 */

import { Prisma, prisma } from "@bigmax/db";
import { enqueueOrderCreatedNotification } from "@bigmax/notifications";
import { uniteller } from "@bigmax/payments";
import { isLocale, type Locale } from "@bigmax/shared-types";
import { NextResponse, type NextRequest } from "next/server";

import { absoluteUrl } from "@/seo/config";
import { computeEarnedPoints, getLoyaltyEarnPercent } from "@/server/loyalty";
import { reportError } from "@/server/observability";
import { writePaymentLog } from "@/server/payment-log";
import { clientIpFromHeaders, enforceRateLimit } from "@/server/rate-limit";
import {
  evaluateCallback,
  parseCallbackBody,
  type CallbackDecision,
} from "@/server/uniteller-callback";

const RATE_LIMIT = 100;
const RATE_WINDOW_SEC = 60;

export async function POST(req: NextRequest): Promise<Response> {
  // --- Rate-limit per IP ----------------------------------------------------
  const ip = clientIpFromHeaders(req.headers);
  const limit = await enforceRateLimit({
    key: `webhook:uniteller:${ip}`,
    limit: RATE_LIMIT,
    windowSec: RATE_WINDOW_SEC,
  });
  if (!limit.ok) {
    return new NextResponse("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  // --- Parse + evaluate -----------------------------------------------------
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return new NextResponse("malformed body", { status: 400 });
  }
  const raw = parseCallbackBody(bodyText);
  const password = process.env["UNITELLER_PASSWORD"] ?? "";
  if (password === "") {
    // Misconfigured — но Uniteller всё равно прислал callback.
    // 500 → пусть retry, к этому моменту админ должен починить env.
    return new NextResponse("payment provider misconfigured", { status: 500 });
  }

  const decision = evaluateCallback({ raw, password });
  if (decision.kind === "invalid_payload") {
    return new NextResponse(`invalid payload: ${decision.issues.join("; ")}`, { status: 400 });
  }
  if (decision.kind === "invalid_signature") {
    // Логируем как потенциальную атаку. PaymentLog без paymentId — связь
    // через Order_IDP в request payload. Sentry-alert: §5.12 «Алерты на
    // провалы webhook» — invalid_signature это либо MITM, либо порча
    // payload'а, в обоих случаях нужно ручное расследование.
    await writePaymentLog({
      action: "webhook_invalid_signature",
      request: raw,
      statusCode: 401,
      errorMessage: `signature mismatch for Order_ID=${decision.payload.Order_ID}`,
    });
    reportError(new Error("uniteller webhook: invalid signature"), {
      scope: "web.webhook.uniteller",
      extra: { orderIdp: decision.payload.Order_ID, status: 401 },
    });
    return new NextResponse("invalid signature", { status: 401 });
  }

  try {
    return await handleValidCallback(decision, raw);
  } catch (err) {
    // Uniteller сделает retry — для нас 500 это OK. Но Sentry дёргаем,
    // т.к. устойчивые 500'ки = падение БД / приложения.
    await writePaymentLog({
      action: "webhook_internal_error",
      request: raw,
      statusCode: 500,
      errorMessage: err instanceof Error ? err.message : "unknown",
    });
    reportError(err, {
      scope: "web.webhook.uniteller",
      extra: { orderIdp: decision.payload.Order_ID, status: 500 },
    });
    return new NextResponse("internal", { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Application logic (после успешной валидации)
// ---------------------------------------------------------------------------

async function handleValidCallback(
  decision: Extract<CallbackDecision, { kind: "valid" }>,
  raw: Record<string, string>,
): Promise<Response> {
  const { payload } = decision;

  // --- Идемпотентность: WebhookEvent (provider, externalId, signature) ----
  const existing = await prisma.webhookEvent.findUnique({
    where: {
      provider_externalId_signature: {
        provider: "uniteller",
        externalId: payload.Order_ID,
        signature: payload.Signature,
      },
    },
  });

  if (existing?.processed) {
    // Точная копия уже обработанного callback'а — игнорируем silently.
    return new NextResponse("ok (duplicate)", { status: 200 });
  }

  const event =
    existing ??
    (await prisma.webhookEvent.create({
      data: {
        provider: "uniteller",
        eventType: payload.Status,
        externalId: payload.Order_ID,
        signature: payload.Signature,
        payload: raw as Prisma.InputJsonValue,
        processed: false,
      },
    }));

  // --- Поиск Payment по unitellerOrderIdp ---------------------------------
  const payment = await prisma.payment.findUnique({
    where: { unitellerOrderIdp: payload.Order_ID },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: {
        select: {
          number: true,
          totalCents: true,
          locale: true,
          // P7-T1: snapshot применённого промокода — нужен для атомарного
          // `Promo.usedCount += 1` на первой капчуре. `null` если промо не было.
          promoCode: true,
          user: { select: { id: true, phone: true, email: true, language: true } },
        },
      },
    },
  });

  if (!payment) {
    // §5.7: «чужая» транзакция — отвечаем 200 + лог. Не оставляем event
    // в processed=false, иначе при повторе Uniteller создадим duplicate.
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true },
    });
    await writePaymentLog({
      action: "webhook_foreign_tx",
      request: raw,
      statusCode: 200,
      errorMessage: `no Payment for Order_ID=${payload.Order_ID}`,
    });
    return new NextResponse("ok (foreign)", { status: 200 });
  }

  // --- Атомарное обновление Payment + Order + WebhookEvent + PaymentLog ----
  const newStatus = uniteller.mapUnitellerStatus(payload.Status);
  const isCaptured = newStatus === "captured";
  // Транзит pending → captured единичен на жизнь Payment'а — поэтому именно
  // здесь триггерим notifications, а не на каждом дублирующемся callback'е.
  const isFirstCapture = isCaptured && payment.status !== "captured";

  // P7-T1: на первой капчуре бампаем `Promo.usedCount` для соблюдения
  // `usageLimit`. `updateMany` — silent no-op если промо удалили (snapshot
  // в Order.promoCode остаётся в audit-следе). До P7-T1 счётчик никогда не
  // инкрементился — `usageLimit` был фиктивным.
  const promoCodeToBump =
    isFirstCapture && payment.order.promoCode ? payment.order.promoCode : null;

  // P7-T2: на первой капчуре начисляем баллы «Бигмах Бонус» — 1% от
  // totalCents, конвертированный в баллы (1 балл = 1 сум = 100 тийн).
  // computeEarnedPoints — pure, безопасно вне tx; user.update + LoyaltyTx.create
  // инлайнятся в этот же $transaction array для атомарности с Payment update.
  // P7-T2 sub-task F: процент earn'а живой — читается из `features` row
  // с 60s Redis-cache (см. `getLoyaltyEarnPercent`); fallback к env.
  const loyaltyUserId = isFirstCapture && payment.order.user ? payment.order.user.id : null;
  const earnedPoints = loyaltyUserId
    ? computeEarnedPoints(payment.order.totalCents, await getLoyaltyEarnPercent())
    : 0;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        ...(payload.Billnumber ? { unitellerBillnumber: payload.Billnumber } : {}),
        ...(payload.Response_Code ? { unitellerResponseCode: payload.Response_Code } : {}),
        ...(payload.CardNumber ? { unitellerCardMask: payload.CardNumber } : {}),
        ...(isCaptured && payment.status !== "captured" ? { capturedAt: new Date() } : {}),
      },
    }),
    ...(isCaptured
      ? [
          prisma.order.update({
            where: { id: payment.orderId },
            data: { status: "confirmed" },
          }),
        ]
      : []),
    ...(promoCodeToBump
      ? [
          prisma.promo.updateMany({
            where: { code: promoCodeToBump },
            data: { usedCount: { increment: 1 } },
          }),
        ]
      : []),
    ...(loyaltyUserId && earnedPoints > 0
      ? [
          prisma.user.update({
            where: { id: loyaltyUserId },
            data: { loyaltyPoints: { increment: earnedPoints } },
          }),
          prisma.loyaltyTransaction.create({
            data: {
              userId: loyaltyUserId,
              orderId: payment.orderId,
              points: earnedPoints,
              type: "earn",
            },
          }),
        ]
      : []),
    prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true },
    }),
    prisma.paymentLog.create({
      data: {
        paymentId: payment.id,
        action: "webhook",
        // §5.12: PAN-маскирование + scrub секретов перед записью в audit-лог.
        request: uniteller.scrubPaymentPayload(raw) as Prisma.InputJsonValue,
        statusCode: 200,
      },
    }),
  ]);

  // P4-T10: enqueue order_created notification на pending → captured переходе.
  // `Waiting/failed/cancelled` не уведомляем — failed-флоу уйдёт в P6 admin
  // (отдельным шаблоном `order_failed` или ручным re-tryом). Fire-and-forget:
  // BullMQ-кладёт job; ответ Uniteller'у не блокируем.
  if (isFirstCapture && payment.order.user) {
    const orderLocale: Locale = isLocale(payment.order.locale) ? payment.order.locale : "ru";
    const userLang: Locale = isLocale(payment.order.user.language)
      ? payment.order.user.language
      : orderLocale;
    try {
      await enqueueOrderCreatedNotification({
        recipient: {
          userId: payment.order.user.id,
          phone: payment.order.user.phone,
          telegramChatId: null, // линковка Telegram-bot — отдельный flow в P6
          email: payment.order.user.email,
          locale: userLang,
        },
        channels: ["sms", "email"], // Telegram пока без линковки — добавится в P6
        payload: {
          orderNumber: payment.order.number,
          totalCents: payment.order.totalCents,
          url: absoluteUrl(`/orders/${payment.orderId}/success`, orderLocale),
        },
      });
    } catch {
      // Best-effort: enqueue-сбой не должен валить webhook. Uniteller всё
      // равно ретраит на 5xx; уведомления — best-effort, не критичны.
    }
  }

  return new NextResponse("ok", { status: 200 });
}
