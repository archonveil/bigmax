/**
 * Zod-схемы контрактов Uniteller (§5.4, §5.7, §5.8 master-prompt Бигмах).
 *
 * Scope для P4-T4 — только shape'ы, никаких HTTP-клиентов. Реальная
 * валидация входящих callback'ов и парсинг XML /results/ — в P4-T6 (webhook)
 * и P4-T9 (pull-проверка) соответственно; здесь мы фиксируем контракт,
 * чтобы эти задачи писались типобезопасно с самого начала.
 *
 * Правило: все Uniteller-поля остаются в их оригинальном `PascalCase` (как
 * в HTTP-форме и callback'е), преобразование в camelCase происходит в
 * client-коде, не в Zod-схемах.
 */

import { z } from "zod";

import {
  INTERNAL_PAYMENT_STATUSES,
  UNITELLER_STATUSES,
  type InternalPaymentStatus,
  type UnitellerStatus,
} from "./constants";

// ---------------------------------------------------------------------------
// Статусы
// ---------------------------------------------------------------------------

export const UnitellerStatusSchema: z.ZodType<UnitellerStatus> = z.enum(UNITELLER_STATUSES);

export const InternalPaymentStatusSchema: z.ZodType<InternalPaymentStatus> =
  z.enum(INTERNAL_PAYMENT_STATUSES);

// ---------------------------------------------------------------------------
// POST /pay/ — параметры self-submitting формы (§5.4)
// ---------------------------------------------------------------------------

/**
 * Обязательные + популярные опциональные поля формы на `UNITELLER.payUrl`.
 * Сервер P4-T5 собирает этот объект, затем сериализует через
 * `application/x-www-form-urlencoded`.
 */
export const PaymentFormParamsSchema = z.object({
  Shop_IDP: z.string().min(1),
  Order_IDP: z
    .string()
    .min(1)
    .regex(/^BGX-\d{8}-\d{4}$/, "Order_IDP must match BGX-YYYYMMDD-NNNN"),
  /** Decimal «15000.00», точка, 2 знака (§6.9). */
  Subtotal_P: z
    .string()
    .regex(/^\d+\.\d{2}$/, "Subtotal_P must be decimal with two fraction digits"),
  Signature: z
    .string()
    .length(32)
    .regex(/^[A-F0-9]{32}$/, "Signature must be 32-char uppercase hex MD5"),
  /** Абсолютный URL, только ASCII (IDN-punycode для bigmax.uz не требуется — домен ascii). */
  URL_RETURN_OK: z.string().url(),
  URL_RETURN_NO: z.string().url(),
  URL_RETURN: z.string().url(),
  Email: z.string().email(),
  /** `+998XXXXXXXXX` — без пробелов, согласно §5.4. */
  Phone: z.string().regex(/^\+998\d{9}$/, "Phone must be +998XXXXXXXXX"),
  /** Uniteller принимает ограниченный набор; передаём «ru» если не поддерживает. */
  Language: z.enum(["ru", "uz", "en"]),
  Lifetime: z.number().int().positive(),

  // ---- опциональные --------------------------------------------------------
  Customer_IDP: z.string().optional(),
  Comment: z.string().max(500).optional(),
  MeanType: z.string().optional(),
  EMoneyType: z.string().optional(),
});

export type PaymentFormParams = z.infer<typeof PaymentFormParamsSchema>;

// ---------------------------------------------------------------------------
// Callback от Uniteller на наш webhook (§5.7)
// ---------------------------------------------------------------------------

/**
 * Тело callback'а в формате `application/x-www-form-urlencoded` от Uniteller.
 * Uniteller допускает доп. поля — оставляем объект открытым через `.passthrough()`
 * в вызывающем коде P4-T6, здесь фиксируем минимум для идемпотентности.
 */
export const UnitellerCallbackPayloadSchema = z.object({
  Order_ID: z.string().min(1),
  Status: UnitellerStatusSchema,
  /** Подпись callback'а, пересчитываемая нами для проверки. */
  Signature: z.string().min(1),
  /** RRN / Billnumber — сохраняем в `Payment.uniteller_billnumber`. */
  Billnumber: z.string().optional(),
  /** Код ответа банка (0 = успех), сохраняется в `Payment.uniteller_response_code`. */
  Response_Code: z.string().optional(),
  MeanType: z.string().optional(),
  /** Маска карты, если Uniteller шлёт — `Payment.uniteller_card_mask`. */
  CardNumber: z.string().optional(),
});

export type UnitellerCallbackPayload = z.infer<typeof UnitellerCallbackPayloadSchema>;

// ---------------------------------------------------------------------------
// Ответ /results/ (pull-проверка статуса, §5.8)
// ---------------------------------------------------------------------------

/**
 * Uniteller /results/ возвращает XML; после парсинга (P4-T9) каждый заказ
 * ложится в этот shape. Даты Uniteller — `YYYY-MM-DD HH:MM:SS` UTC.
 */
export const UnitellerResultsItemSchema = z.object({
  OrderId: z.string(),
  Status: UnitellerStatusSchema,
  Total: z.string().regex(/^\d+\.\d{2}$/),
  Billnumber: z.string().optional(),
  ApprovalCode: z.string().optional(),
  LastModified: z.string().optional(),
});

export type UnitellerResultsItem = z.infer<typeof UnitellerResultsItemSchema>;
