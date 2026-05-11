/**
 * Uniteller — публичные константы: URL, статусы, мапинг Uniteller-→-внутренних,
 * форматирование суммы. Чистый модуль, без зависимостей и side-effects.
 *
 * Источник: «Интернет-эквайринг» v1.43+ (технический порядок Uniteller),
 * master-prompt Бигмах §5.2, §5.8, §6.9.
 */

// ---------------------------------------------------------------------------
// URL'ы (§5.2 master-prompt)
// ---------------------------------------------------------------------------

/**
 * Дефолтная базовая URL'ка Uniteller. В dev/e2e можно переопределить через
 * `UNITELLER_BASE_URL` env (например, `http://localhost:8787` для
 * mock-server'а из P4-T12) — getter'ы ниже резолвят env лениво при каждом
 * обращении, чтобы тесты могли подменять env между прогонами.
 */
const UNITELLER_DEFAULT_BASE = "https://wpay.uniteller.ru";

function resolveBase(): string {
  const env = typeof process !== "undefined" ? process.env["UNITELLER_BASE_URL"] : undefined;
  if (env && env !== "") {
    return env.replace(/\/$/, "");
  }
  return UNITELLER_DEFAULT_BASE;
}

export const UNITELLER = {
  /** URL формы оплаты (POST с application/x-www-form-urlencoded). */
  get payUrl(): string {
    return `${resolveBase()}/pay/`;
  },
  /** URL запроса статуса (GET с basic-auth, Format=XML). */
  get resultsUrl(): string {
    return `${resolveBase()}/results/`;
  },
  /** WSDL для SOAP-клиента (на будущее — не используется напрямую). */
  get wsdlUrl(): string {
    return `${resolveBase()}/results/wsdl/`;
  },
  /** Отмена/возврат (POST, Billnumber или OrderID + auth). */
  get cancelUrl(): string {
    return `${resolveBase()}/cancel/`;
  },
  /** Личный кабинет — только для документации; не override'ится env'ом. */
  dashboardUrl: "https://lk.uniteller.ru/",
} as const;

/** Дефолтный Lifetime ссылки оплаты в минутах (§5.4). */
export const UNITELLER_DEFAULT_LIFETIME_MIN = 30;

// ---------------------------------------------------------------------------
// Статусы
// ---------------------------------------------------------------------------

/**
 * Статусы, которые Uniteller возвращает в callback и в /results/.
 * Источник: документация Uniteller v1.43+, §5.8 master-prompt.
 */
export const UNITELLER_STATUSES = [
  "Authorized",
  "Paid",
  "Canceled",
  "NotAuthorized",
  "Waiting",
] as const;

export type UnitellerStatus = (typeof UNITELLER_STATUSES)[number];

/**
 * Наши внутренние статусы `Payment.status` (enum из Prisma schema P0-T3).
 */
export const INTERNAL_PAYMENT_STATUSES = [
  "pending",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

export type InternalPaymentStatus = (typeof INTERNAL_PAYMENT_STATUSES)[number];

/**
 * Мапинг Uniteller-статусов во внутренние (§5.8):
 *   - Authorized, Paid     → captured
 *   - Canceled, NotAuthorized → failed
 *   - Waiting              → остаётся pending
 *
 * Возвращаемое значение всегда безопасно присваивать `Payment.status`.
 */
export function mapUnitellerStatus(s: UnitellerStatus): InternalPaymentStatus {
  switch (s) {
    case "Authorized":
    case "Paid":
      return "captured";
    case "Canceled":
    case "NotAuthorized":
      return "failed";
    case "Waiting":
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Форматирование суммы (§6.9 master-prompt)
// ---------------------------------------------------------------------------

/**
 * Конвертирует integer `cents` (тийин) в строку `Subtotal_P` для Uniteller:
 * `1_500_000 → "15000.00"`. Всегда 2 знака после точки, без тысячных
 * разделителей, точка как dot separator.
 *
 * **NB:** Uniteller отвергает отрицательные и нулевые суммы — проверяй на
 * стороне вызывающего кода (P4-T5 `POST /api/checkout/pay`). Здесь мы только
 * форматируем, чтобы не смешивать уровни ответственности.
 */
export function centsToUnitellerSubtotal(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Uniteller subtotal requires integer tiyin, got ${cents}`);
  }
  if (cents < 0) {
    throw new RangeError(`Uniteller subtotal cannot be negative, got ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}
