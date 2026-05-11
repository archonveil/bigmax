/**
 * Построение подписи для формы оплаты Uniteller (§5.5 master-prompt Бигмах,
 * «Интернет-эквайринг» v1.43+).
 *
 *   Signature = MD5(
 *     MD5(Shop_IDP) + "&" +
 *     MD5(Order_IDP) + "&" +
 *     MD5(Subtotal_P) + "&" +
 *     MD5(MeanType) + "&" +
 *     MD5(EMoneyType) + "&" +
 *     MD5(Password)
 *   ).toUpperCase()
 *
 * Возвращается ровно 32-символьный hex-upper. Опциональные `MeanType` и
 * `EMoneyType` передаются в hash как пустая строка (MD5("") =
 * "d41d8cd98f00b204e9800998ecf8427e").
 *
 * Модуль только вычисляет подпись — никаких побочных эффектов, никаких
 * операций с БД/сетью. Используется сервером при создании платежа в P4-T5
 * (`POST /api/checkout/pay`); тот же алгоритм будет переиспользован в
 * P4-T12 (mock-server с валидацией подписи для e2e-тестов).
 *
 * Безопасность: `password` — `env.UNITELLER_PASSWORD`, **только на сервере**
 * (§5.12). Никогда не передавать в клиентский код / `NEXT_PUBLIC_*`.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export interface BuildSignatureParams {
  /** `Shop_IDP` из ЛК Uniteller (`env.UNITELLER_SHOP_ID`). */
  shopId: string;
  /** `Order_IDP` — номер заказа (формат `BGX-YYYYMMDD-NNNN`). */
  orderId: string;
  /** Сумма в формате Uniteller, например `"15000.00"` (см. `centsToUnitellerSubtotal`). */
  subtotal: string;
  /** Опциональный способ оплаты. Пропуск = передать `""`. */
  meanType?: string;
  /** Опциональный тип электронных денег. Пропуск = передать `""`. */
  eMoneyType?: string;
  /** `UNITELLER_PASSWORD` — секрет для подписи. Только на сервере. */
  password: string;
}

/**
 * Считает Uniteller Signature для POST /pay/.
 *
 * @throws {TypeError} если `shopId`, `orderId`, `subtotal` или `password` пусты:
 *   Uniteller отвергает такие формы и их подписи бессмысленно считать.
 *   `meanType`/`eMoneyType` могут быть пустыми (штатное поведение).
 */
export function buildSignature(params: BuildSignatureParams): string {
  const { shopId, orderId, subtotal, meanType = "", eMoneyType = "", password } = params;

  // Пустоты в обязательных полях — скорее всего баг вызывающего кода.
  // Валим громко, чтобы не отправить невалидную форму Uniteller'у.
  if (shopId === "") throw new TypeError("Uniteller buildSignature: shopId is empty");
  if (orderId === "") throw new TypeError("Uniteller buildSignature: orderId is empty");
  if (subtotal === "") throw new TypeError("Uniteller buildSignature: subtotal is empty");
  if (password === "") throw new TypeError("Uniteller buildSignature: password is empty");

  const raw =
    md5(shopId) +
    "&" +
    md5(orderId) +
    "&" +
    md5(subtotal) +
    "&" +
    md5(meanType) +
    "&" +
    md5(eMoneyType) +
    "&" +
    md5(password);

  return md5(raw).toUpperCase();
}

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Callback signature (webhook от Uniteller, §5.7 master-prompt Бигмах)
// ---------------------------------------------------------------------------

export interface VerifyCallbackSignatureParams {
  /** `Order_ID` из тела callback'а. */
  orderId: string;
  /** `Status` из тела callback'а (Authorized / Paid / Canceled / NotAuthorized / Waiting). */
  status: string;
  /** `Signature` из тела callback'а — то, что нужно проверить. */
  signature: string;
  /** `UNITELLER_PASSWORD` — серверный секрет, не из callback'а. */
  password: string;
}

/**
 * Проверяет подпись callback'а Uniteller. По «Интернет-эквайринг» v1.43+
 * (тех. порядок Uniteller):
 *
 *   Signature_callback = MD5(
 *     MD5(Order_ID) + MD5(Status) + MD5(Password)
 *   ).toUpperCase()
 *
 * Сравнение выполняется через `crypto.timingSafeEqual` — защита от timing-
 * атак, при которых различие в первых байтах можно угадать по latency.
 *
 * Возвращает `true` только если все байты совпадают **и** длина 32. Любые
 * пустые поля → `false` (не бросаем — webhook'и приходят непредсказуемо,
 * молча отказывать удобнее, чем 500-ить).
 */
export function verifyCallbackSignature(params: VerifyCallbackSignatureParams): boolean {
  const { orderId, status, signature, password } = params;
  if (orderId === "" || status === "" || password === "") return false;
  if (signature.length !== 32) return false;

  const expected = computeCallbackSignature(orderId, status, password);

  // toUpperCase для устойчивости к разному регистру в callback'е (Uniteller
  // присылает HEX-upper, но клиенты иногда нормализуют).
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toUpperCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Внутренний расчёт callback-подписи. Экспортируется для тестов и для
 * mock-server'а (P4-T12), которому нужно генерировать валидные callback'и.
 */
export function computeCallbackSignature(
  orderId: string,
  status: string,
  password: string,
): string {
  return md5(md5(orderId) + md5(status) + md5(password)).toUpperCase();
}
