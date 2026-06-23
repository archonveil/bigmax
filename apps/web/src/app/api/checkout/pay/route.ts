/**
 * `POST /api/checkout/pay` (P4-T5 + P4-T8 master-prompt).
 *
 * Общие шаги (для обоих provider'ов):
 *   1. `auth()` → 401.
 *   2. Zod-валидация тела (CheckoutPayRequestSchema).
 *   3. Re-fetch цен вариантов (anti-tamper).
 *   4. Server-side recompute: subtotal → delivery (`estimateDelivery`) →
 *      discount (`validatePromoCode`) → total.
 *   5. Prisma transaction: Order + OrderItems(snapshot) + Payment(pending) с
 *      retry на unique-конфликте `Order.number`.
 *
 * **Provider-specific:**
 *   - **uniteller**: env-check `UNITELLER_SHOP_ID/PASSWORD` → 503; `total > 0`
 *     обязателен (Uniteller отвергает 0-суммы); `Payment.unitellerOrderIdp`
 *     заполняется; ответ — `text/html` self-submit форма с `Signature` на
 *     `UNITELLER.payUrl`.
 *   - **cod**: env-check не нужен; `total >= 0` (промо может занулить);
 *     `Payment.unitellerOrderIdp = null`; ответ — `application/json`
 *     с `{ok, provider:"cod", orderId, orderNumber, redirectTo}` —
 *     клиент делает router.push на success-страницу.
 *
 * Бизнес-ошибки клиенту: `application/json` с `CheckoutPayErrorSchema`.
 *
 * Безопасность (§5.12): секреты Uniteller читаются только из process.env,
 * `Signature` считается здесь, никогда не приходит с клиента.
 */

import { Prisma, prisma } from "@bigmax/db";
import { enqueueOrderCreatedNotification } from "@bigmax/notifications";
import { uniteller } from "@bigmax/payments";
import {
  buildOrderNumber,
  CheckoutPayRequestSchema,
  estimateDelivery,
  type CheckoutPayCodSuccess,
  type CheckoutPayError,
  type CheckoutPayRequest,
  type Locale,
} from "@bigmax/shared-types";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { computeDeliveryDiscountCents, computeDiscountCents } from "@/cart/promo";
import { absoluteUrl } from "@/seo/config";
import {
  clampPointsToSpend,
  computeLoyaltyDiscountCents,
  isLoyaltySpendEnabled,
  spendLoyaltyPoints,
} from "@/server/loyalty";
import { reportError } from "@/server/observability";
import { reserveOrderStock } from "@/server/order-stock-movement";
import { nextOrderSequenceForDay, renderUnitellerRedirectHtml } from "@/server/orders";
import { writePaymentLog } from "@/server/payment-log";
import { validatePromoCode } from "@/server/promo";

// Максимум попыток на случай гонки `Order.number` (одновременные чекауты).
const ORDER_NUMBER_MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return jsonError("unauthorized", 401);
  }

  // --- Parse body -----------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_body", 400, "malformed JSON");
  }

  const parsed = CheckoutPayRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_body", 400, parsed.error.issues[0]?.message);
  }
  const request = parsed.data;
  const isUniteller = request.payment.method === "uniteller";

  // --- Provider-specific env-check (Uniteller only) ------------------------
  const shopId = process.env["UNITELLER_SHOP_ID"] ?? "";
  const password = process.env["UNITELLER_PASSWORD"] ?? "";
  if (isUniteller && (shopId === "" || password === "")) {
    return jsonError("payment_provider_misconfigured", 503);
  }

  // --- Re-fetch цен вариантов ----------------------------------------------
  const variantIds = request.items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { isActive: true } },
    select: {
      id: true,
      priceCents: true,
      sku: true,
      color: true,
      size: true,
      product: { select: { slug: true, nameRu: true, nameUz: true, nameEn: true } },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // Любой отсутствующий/неактивный вариант → отказ
  for (const item of request.items) {
    if (!variantById.has(item.variantId)) {
      return jsonError("invalid_variant", 400, `unknown variantId: ${item.variantId}`);
    }
  }

  // --- Recompute итогов -----------------------------------------------------
  const subtotalCents = request.items.reduce((sum, item) => {
    const v = variantById.get(item.variantId);
    return sum + (v ? v.priceCents * item.quantity : 0);
  }, 0);
  if (subtotalCents <= 0) {
    return jsonError("empty_cart", 400);
  }

  const estimate = estimateDelivery({
    method: request.delivery.method,
    region: request.address?.region ?? "",
    district: request.address?.district ?? "",
    subtotalCents,
  });
  if (estimate.kind === "needs-info") {
    return jsonError("invalid_delivery", 400, `estimate: ${estimate.reason}`);
  }
  let deliveryCents = estimate.cents;

  let discountCents = 0;
  // P7-T1: snapshot применённого промокода (UPPER) — пишется в `Order.promoCode`
  // и используется webhook'ом Uniteller (либо COD-mark-delivered в будущем)
  // для атомарного `Promo.usedCount += 1` на первой капчуре. До P7-T1 счётчик
  // никогда не инкрементился — `usageLimit` был фиктивным.
  let appliedPromoCode: string | null = null;
  if (request.promoCode) {
    const res = await validatePromoCode(request.promoCode, subtotalCents);
    if (!res.ok) {
      return jsonError("invalid_promo", 400, res.reason);
    }
    discountCents = computeDiscountCents(res.promo, subtotalCents);
    deliveryCents = Math.max(
      0,
      deliveryCents - computeDeliveryDiscountCents(res.promo, deliveryCents),
    );
    appliedPromoCode = res.promo.code.toUpperCase();
  }

  // P7-T2: «Бигмах Бонус» — списание баллов лояльности.
  // pointsToSpend приходит из клиента, но clamp'ится на сервере по реальному
  // балансу `User.loyaltyPoints`. Discount = points × 100 тийн. Считается
  // ПОСЛЕ promo, чтобы баллы могли уменьшить уже-discounted-сумму, но не
  // превышали `totalCents - 1` (Uniteller не принимает 0-amount).
  //
  // P7-T2 sub-task L: глобальный kill-switch через feature flag
  // `loyalty.spend_enabled`. Если admin переключил его в `false` (emergency,
  // fraud incident, баг в clamp-логике) — spend полностью пропускается, но
  // earn-flow продолжает работать (асимметричное отключение).
  let loyaltyPointsSpent = 0;
  let loyaltyDiscountCents = 0;
  if (request.pointsToSpend && request.pointsToSpend > 0 && (await isLoyaltySpendEnabled())) {
    const userRow = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { loyaltyPoints: true },
    });
    const balance = userRow?.loyaltyPoints ?? 0;
    // totalCents до loyalty-discount'а — используется как cap.
    const totalBeforeLoyalty = Math.max(0, subtotalCents - discountCents + deliveryCents);
    loyaltyPointsSpent = clampPointsToSpend(request.pointsToSpend, balance, totalBeforeLoyalty);
    loyaltyDiscountCents = computeLoyaltyDiscountCents(loyaltyPointsSpent);
  }

  const totalCents = Math.max(
    0,
    subtotalCents - discountCents + deliveryCents - loyaltyDiscountCents,
  );
  // Uniteller отвергает 0-суммы; для полностью-бесплатного заказа (промо +
  // free_delivery) единственный путь — COD. Поэтому блок только для Uniteller.
  if (isUniteller && totalCents <= 0) {
    return jsonError("invalid_delivery", 400, "total_zero");
  }

  // --- Создание Order + Payment в транзакции с retry на unique-конфликте ---
  const locale = request.locale as Locale;
  const now = new Date();
  let order: { id: string; number: string; paymentId: string } | null;
  try {
    order = await createOrderWithRetry({
      userId: session.user.id,
      now,
      locale,
      request,
      variants: variantById,
      subtotalCents,
      discountCents,
      deliveryCents,
      totalCents,
      provider: isUniteller ? "uniteller" : "cod",
      promoCode: appliedPromoCode,
      loyaltyPointsSpent,
    });
  } catch (err) {
    // §5.12: 5xx из транзакции = БД/приложение упало. Sentry-alert + audit-log.
    reportError(err, {
      scope: "web.checkout.pay",
      extra: {
        userId: session.user.id,
        provider: isUniteller ? "uniteller" : "cod",
        totalCents,
      },
    });
    await writePaymentLog({
      action: isUniteller ? "create_uniteller_failed" : "create_cod_failed",
      request,
      statusCode: 500,
      errorMessage: err instanceof Error ? err.message : "unknown",
    });
    return jsonError("internal", 500, "failed to create order");
  }
  if (!order) {
    await writePaymentLog({
      action: isUniteller ? "create_uniteller_failed" : "create_cod_failed",
      request,
      statusCode: 500,
      errorMessage: "failed to allocate order number",
    });
    return jsonError("internal", 500, "failed to allocate order number");
  }

  // --- COD branch: JSON redirect, никакого Uniteller ----------------------
  if (!isUniteller) {
    // P4-T10: COD-заказ создан и логически принят — шлём `order_created`
    // уведомление сразу. Для Uniteller аналогичный enqueue делает webhook
    // на pending → captured переходе (P4-T6).
    try {
      await enqueueOrderCreatedNotification({
        recipient: {
          userId: session.user.id,
          phone: request.contacts.phone,
          telegramChatId: null,
          email: request.contacts.email,
          locale,
        },
        channels: ["sms", "email"],
        payload: {
          orderNumber: order.number,
          totalCents,
          url: absoluteUrl(`/orders/${order.id}/success`, locale),
        },
      });
    } catch {
      // Best-effort: enqueue-сбой не должен валить чекаут.
    }
    // §5.12 audit-trail: PaymentLog row на каждое создание заказа.
    await writePaymentLog({
      paymentId: order.paymentId,
      action: "create_cod",
      request,
      statusCode: 200,
    });
    const body: CheckoutPayCodSuccess = {
      ok: true,
      provider: "cod",
      orderId: order.id,
      orderNumber: order.number,
      redirectTo: `/${locale}/orders/${order.id}/success`,
    };
    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store, private" },
    });
  }

  // --- Uniteller Signature + self-submit HTML ------------------------------
  // Currency: per Uniteller spec §4.1.2 table 1, REQUIRED for any non-RUB shop.
  // Site prices are stored in UZS tiyin (`totalCents`). If the Uniteller shop is
  // configured for a different currency, convert the amount before signing —
  // otherwise Uniteller rejects with "Incorrect currency" or charges the literal
  // soum value as foreign currency (e.g. 160,074 soums → $160,074 USD).
  const unitellerCurrency = process.env["UNITELLER_CURRENCY"] ?? "RUB";
  // UZS per 1 unit of target currency. e.g. 12700 = 1 USD costs 12700 soums.
  // Pulled from env so the rate can be tuned without redeploys.
  const fxRate = Number.parseFloat(process.env["UNITELLER_UZS_RATE"] ?? "12700");
  // Any currency other than UZS needs conversion since site prices are in soums.
  // (RUB shops also need it — sending raw soum value as rubles would be ~10× off.)
  const needsFxConversion = unitellerCurrency !== "UZS" && fxRate > 0;
  // Convert UZS tiyin → target-currency cents. UZS has 100 tiyin per soum, USD has
  // 100 cents per dollar, so the rate factor cancels out cleanly: rate UZS per USD
  // means `targetCents = uzsCents / rate`. Round half-up to avoid undercharging.
  const subtotalForUniteller = needsFxConversion ? Math.round(totalCents / fxRate) : totalCents;
  const subtotalStr = uniteller.centsToUnitellerSubtotal(subtotalForUniteller);
  // Lifetime sent in the form must be included in the hash with its actual
  // value (Uniteller spec §4.1.2, table 1). Mismatched signature = /pay/error.
  const lifetimeStr = "30";
  const signature = uniteller.buildSignature({
    shopId,
    orderId: order.number,
    subtotal: subtotalStr,
    lifetime: lifetimeStr,
    password,
  });

  const fields: Record<string, string | number> = {
    Shop_IDP: shopId,
    Order_IDP: order.number,
    Subtotal_P: subtotalStr,
    Signature: signature,
    URL_RETURN_OK: absoluteUrl(`/orders/${order.id}/success`, locale),
    URL_RETURN_NO: absoluteUrl(`/orders/${order.id}/failure`, locale),
    URL_RETURN: absoluteUrl(`/orders/${order.id}/return`, locale),
    Email: request.contacts.email,
    Phone: request.contacts.phone.replace(/\s+/g, ""),
    Language: locale,
    Lifetime: lifetimeStr,
    Currency: unitellerCurrency,
  };

  const isMock =
    process.env["UNITELLER_MODE"] === "mock" && process.env["NODE_ENV"] !== "production";
  const payUrl = isMock
    ? `${(process.env["APP_URL"] ?? "http://localhost:3000").replace(/\/$/, "")}/api/mock/uniteller/pay`
    : uniteller.UNITELLER.payUrl;

  const html = renderUnitellerRedirectHtml(payUrl, fields);
  // §5.12 audit-trail: PaymentLog row при выдаче redirect-формы. Signature
  // сохранится — она вычислена из `Order_IDP+Subtotal+password`, но `password`
  // в payload'е нет, а `Signature` сама по себе не secret (Uniteller её
  // публично возвращает в callback'е). На всякий — scrub помечает её REDACTED.
  await writePaymentLog({
    paymentId: order.paymentId,
    action: "create_uniteller",
    request,
    response: { fields, payUrl: uniteller.UNITELLER.payUrl },
    statusCode: 200,
  });
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type VariantInfo = {
  id: string;
  priceCents: number;
  sku: string;
  color: string | null;
  size: string | null;
  product: {
    slug: string;
    nameRu: string;
    nameUz: string;
    nameEn: string;
  };
};

interface CreateOrderInput {
  userId: string;
  now: Date;
  locale: Locale;
  request: CheckoutPayRequest;
  variants: Map<string, VariantInfo>;
  subtotalCents: number;
  discountCents: number;
  deliveryCents: number;
  totalCents: number;
  provider: "uniteller" | "cod";
  /** UPPER snapshot применённого промокода, либо `null` если промо не было. */
  promoCode: string | null;
  /** P7-T2: количество баллов «Бигмах Бонус» к списанию (уже clamp'ed). */
  loyaltyPointsSpent: number;
}

async function createOrderWithRetry(
  input: CreateOrderInput,
): Promise<{ id: string; number: string; paymentId: string } | null> {
  for (let attempt = 0; attempt < ORDER_NUMBER_MAX_ATTEMPTS; attempt += 1) {
    const sequence = await nextOrderSequenceForDay(input.now);
    if (sequence > 9999) return null; // дневной лимит NNNN исчерпан
    const number = buildOrderNumber(input.now, sequence);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId: input.userId,
            number,
            status: "pending",
            locale: input.locale,
            subtotalCents: input.subtotalCents,
            deliveryCostCents: input.deliveryCents,
            discountCents: input.discountCents,
            totalCents: input.totalCents,
            currency: "UZS",
            deliveryMethod: input.request.delivery.method,
            branchId:
              input.request.delivery.method === "pickup" ? input.request.delivery.branchId : null,
            // addressId заполняется в P5, если юзер выбрал сохранённый адрес.
            addressId: null,
            comment: input.request.delivery.comment || null,
            // P7-T1: snapshot промокода — denormalized String, не FK. Используется
            // webhook'ом для `Promo.usedCount += 1` на первой капчуре.
            promoCode: input.promoCode,
            // P7-T2: snapshot потраченных баллов лояльности. Списание баллов
            // с `User.loyaltyPoints` происходит ниже через `spendLoyaltyPoints(tx,…)`.
            loyaltyPointsSpent: input.loyaltyPointsSpent,
          },
          select: { id: true, number: true },
        });

        await tx.orderItem.createMany({
          data: input.request.items.map((item) => {
            const v = input.variants.get(item.variantId);
            if (!v) throw new Error(`variant gone during tx: ${item.variantId}`);
            return {
              orderId: order.id,
              variantId: v.id,
              quantity: item.quantity,
              priceCents: v.priceCents,
              productSnapshot: {
                sku: v.sku,
                color: v.color,
                size: v.size,
                product: v.product,
              } satisfies Prisma.InputJsonValue,
            };
          }),
        });

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: input.provider,
            status: "pending",
            amountCents: input.totalCents,
            currency: "UZS",
            // unitellerOrderIdp осмысленен только для Uniteller-flow
            // (callback-сопоставление). Для COD поля нет.
            ...(input.provider === "uniteller" ? { unitellerOrderIdp: order.number } : {}),
          },
          select: { id: true },
        });

        // P6-T7 follow-up (closes (d)-полное): reserve stock на checkout —
        // инкрементим Stock.reserved для каждого item'а + StockLog audit.
        // Best-effort: если Stock-row не существует или branch-routing не
        // резолвится, попадает в skipped[] (не валим заказ — товар может
        // быть «доступен» через другой склад, и admin позже починит вручную).
        await reserveOrderStock({ orderId: order.id, adminUserId: null, tx });

        // P7-T2: списание баллов лояльности (atomic с Order create — гарантирует,
        // что баланс не уйдёт в минус и Order не будет создан без spend-записи).
        await spendLoyaltyPoints(tx, {
          userId: input.userId,
          orderId: order.id,
          points: input.loyaltyPointsSpent,
        });

        return { id: order.id, number: order.number, paymentId: payment.id };
      });
      return created;
    } catch (err) {
      // Unique-конфликт `Order.number` → retry следующей sequence.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = err.meta?.["target"];
        if (Array.isArray(target) && target.includes("number")) continue;
      }
      throw err;
    }
  }
  return null;
}

function jsonError(
  reason: CheckoutPayError["reason"],
  status: number,
  message?: string,
): NextResponse {
  const body: CheckoutPayError = message ? { ok: false, reason, message } : { ok: false, reason };
  return NextResponse.json(body, { status });
}
