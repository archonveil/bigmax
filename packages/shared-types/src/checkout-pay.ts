/**
 * Контракт `POST /api/checkout/pay` (P4-T5 master-prompt).
 *
 * Клиент отправляет **сырой draft** чекаута (то, что лежит в Zustand-store
 * `bigmax:checkout-draft` + `bigmax:cart`) + опциональный `promoCode`.
 * Сервер повторно валидирует всё: цены вариантов пересчитываются из БД
 * (anti-tamper), стоимость доставки — через `estimateDelivery`, скидка —
 * через серверный `validatePromoCode`.
 *
 * Эта схема намеренно дублирует поля ContactsStepSchema/AddressStepSchema/
 * DeliveryStepSchema/PaymentStepSchema из `apps/web/src/checkout/schemas.ts`:
 * web-схемы нельзя импортировать из shared-types (upstream), а API-контракт
 * обязан жить именно здесь (§6, правило 2).
 */

import { z } from "zod";

import { isLocale } from "./locales";
import { UZ_PHONE_REGEX } from "./phone";
import { isUzRegionSlug } from "./regions";

// --- Contacts ---------------------------------------------------------------

export const CheckoutPayContactsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().regex(UZ_PHONE_REGEX, { message: "invalid_phone" }),
});

// --- Address (обязателен для courier, опционален для pickup) ----------------

export const CheckoutPayAddressSchema = z.object({
  region: z.string().refine(isUzRegionSlug, { message: "invalid_region" }),
  city: z.string().trim().min(1).max(100),
  district: z.string().trim().max(100).default(""),
  street: z.string().trim().min(1).max(200),
  house: z.string().trim().min(1).max(50),
  apartment: z.string().trim().max(50).default(""),
  landmark: z.string().trim().max(200).default(""),
  phone: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || UZ_PHONE_REGEX.test(v), { message: "invalid_phone" }),
});

// --- Delivery / Payment -----------------------------------------------------

export const CheckoutPayDeliverySchema = z
  .object({
    method: z.enum(["courier", "pickup"]),
    branchId: z.string().trim().default(""),
    comment: z.string().trim().max(500).default(""),
  })
  .refine((d) => d.method !== "pickup" || d.branchId.length > 0, {
    path: ["branchId"],
    message: "branch_required",
  });

export const CheckoutPayPaymentSchema = z.object({
  method: z.enum(["uniteller", "cod", "uzum"]),
});

// --- Items (re-fetched from DB by server, so here — только ссылки) ----------

export const CheckoutPayItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
});

// --- Корневой запрос --------------------------------------------------------

export const CheckoutPayRequestSchema = z
  .object({
    contacts: CheckoutPayContactsSchema,
    /** Пропускается только для pickup-заказов (branchId — адрес доставки). */
    address: CheckoutPayAddressSchema.optional(),
    delivery: CheckoutPayDeliverySchema,
    payment: CheckoutPayPaymentSchema,
    items: z.array(CheckoutPayItemSchema).min(1).max(100),
    /** Код локали для Order.locale + Uniteller Language + URL_RETURN_*. */
    locale: z.string().refine(isLocale, { message: "invalid_locale" }),
    promoCode: z.string().trim().max(40).optional(),
    /**
     * P7-T2 «Бигмах Бонус»: количество баллов к списанию (положительное).
     * Server-side clamp'нется через `clampPointsToSpend(requested, balance,
     * totalCents)` — клиент не authoritative. Можно посылать 0/null/undefined
     * → spend пропускается. Cap 10_000_000 = anti-DoS, реальный потолок
     * выставляет user.loyaltyPoints на сервере.
     */
    pointsToSpend: z.number().int().min(0).max(10_000_000).optional(),
  })
  .refine((r) => r.delivery.method !== "courier" || r.address !== undefined, {
    path: ["address"],
    message: "address_required_for_courier",
  });

export type CheckoutPayRequest = z.infer<typeof CheckoutPayRequestSchema>;

// --- Ответ ------------------------------------------------------------------

/**
 * Happy-path responses:
 *
 *   - **Uniteller**: сервер возвращает `text/html` self-submit форму.
 *     Клиент делает `document.open/write/close` — браузер автосабмитит на
 *     `UNITELLER.payUrl`.
 *   - **COD**: сервер возвращает `application/json` с `redirectTo` —
 *     ссылкой на success-страницу заказа. Никакого Uniteller-flow.
 *
 * Шорсе один контракт `CheckoutPayCodSuccess`, который покрывает только
 * COD-ответ; для Uniteller типизация не нужна (HTML-документ).
 */
export const CheckoutPayCodSuccessSchema = z.object({
  ok: z.literal(true),
  provider: z.literal("cod"),
  orderId: z.string(),
  orderNumber: z.string(),
  /** Абсолютный или относительный URL success-страницы. */
  redirectTo: z.string(),
});

export type CheckoutPayCodSuccess = z.infer<typeof CheckoutPayCodSuccessSchema>;

/**
 * Uzum Bank Merchant API: заказ создаётся у нас, оплата проходит в приложении
 * Uzum Bank. Сервер возвращает `redirectTo` — диплинк
 * `https://uzumbank.uz/open-service?serviceId=...&account=<orderNumber>`,
 * по которому открывается форма оплаты в приложении. Дальнейшие переходы
 * статуса (check/create/confirm/reverse) приходят вебхуками на
 * `/api/webhooks/uzum`.
 */
export const CheckoutPayUzumSuccessSchema = z.object({
  ok: z.literal(true),
  provider: z.literal("uzum"),
  orderId: z.string(),
  orderNumber: z.string(),
  /** Диплинк оплаты в приложении Uzum Bank. */
  redirectTo: z.string(),
});

export type CheckoutPayUzumSuccess = z.infer<typeof CheckoutPayUzumSuccessSchema>;

export const CheckoutPayErrorSchema = z.object({
  ok: z.literal(false),
  reason: z.enum([
    "unauthorized",
    "invalid_body",
    "empty_cart",
    "invalid_variant",
    "invalid_promo",
    "invalid_delivery",
    "cod_not_implemented",
    "payment_provider_misconfigured",
    "internal",
  ]),
  message: z.string().optional(),
});

export type CheckoutPayError = z.infer<typeof CheckoutPayErrorSchema>;

// ---------------------------------------------------------------------------
// `GET /api/orders/[id]/status` — для return-страниц P4-T7 (polling)
// ---------------------------------------------------------------------------

/**
 * Снимок статуса заказа для UI-страниц `URL_RETURN_OK / NO / RETURN`.
 * Возвращается только владельцу заказа (auth-gated).
 *
 * Не отдаём детали состава корзины и адрес — UI на этих страницах их не
 * показывает; для полной информации будет `/account/orders/:id` в P5-T2.
 */
export const OrderStatusResponseSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum([
    "pending",
    "confirmed",
    "packing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
  ]),
  paymentStatus: z.enum([
    "pending",
    "captured",
    "failed",
    "cancelled",
    "refunded",
    "partially_refunded",
  ]),
  paymentProvider: z.enum(["uniteller", "cod", "uzum"]),
  totalCents: z.number().int().nonnegative(),
  currency: z.string(),
  locale: z.enum(["ru", "uz", "en"]),
});

export type OrderStatusResponse = z.infer<typeof OrderStatusResponseSchema>;
