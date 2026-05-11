/**
 * Маскирование PAN и скраббинг секретов для PaymentLog (§5.12 master-prompt
 * Бигмах). Используется и web (`writePaymentLog` в webhook/pay-route), и
 * worker (pull-job) — поэтому живёт в `@bigmax/payments` (server-only,
 * никаких client-bundle зависимостей).
 *
 * Логика:
 *   - **PAN-маскирование**: `1234 5678 9012 3456` → `**** **** **** 3456`,
 *     `1234567890123456` → `************3456`. Любая последовательность
 *     13–19 цифр (минимальная длина PAN ISO/IEC 7812) считается потенциальным
 *     PAN'ом и маскируется. Uniteller обычно сам присылает уже маскированный
 *     `4000 **** **** 2487` — для него `maskCardNumber` идемпотентен.
 *   - **Scrub секретов**: ключи `password`, `Signature`, `auth*`, `*_secret`,
 *     `*_token`, `apiKey`, `bearer*` — вырезаются (значение → `"[REDACTED]"`).
 *     Это защита от случайного попадания env-секретов в `PaymentLog.request`.
 */

const PAN_LIKE = /(?<![\d])(\d[\d\s-]{11,21}\d)(?![\d])/g;
const PAN_DIGITS_ONLY = /^\d+$/;
const SECRET_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^password$/i,
  /^signature$/i,
  /_secret$/i,
  /_token$/i,
  /^auth_?login$/i,
  /^auth_?password$/i,
  /^api_?key$/i,
  /^bearer/i,
];

/**
 * Маскирует все PAN-подобные подпоследовательности в строке. Для каждой
 * группы 13–19 цифр (с возможными пробелами/дефисами) сохраняет последние
 * 4 цифры, остальные заменяет на `*` посимвольно (digits → `*`,
 * separators → keep). Идемпотентно: уже-маскированные значения не трогает.
 */
export function maskCardNumber(input: string): string {
  if (typeof input !== "string" || input.length < 13) return input;
  return input.replace(PAN_LIKE, (match) => {
    const compact = match.replace(/[\s-]/g, "");
    if (!PAN_DIGITS_ONLY.test(compact)) return match;
    if (compact.length < 13 || compact.length > 19) return match;
    const last4 = compact.slice(-4);
    let kept = 0;
    let result = "";
    // Идём с конца, считаем 4 последних digit'а (включая separator-сохранение).
    for (let i = match.length - 1; i >= 0; i -= 1) {
      const ch = match[i]!;
      if (/\d/.test(ch)) {
        if (kept < 4) {
          result = ch + result;
          kept += 1;
        } else {
          result = "*" + result;
        }
      } else {
        result = ch + result;
      }
    }
    void last4; // last4 captured implicitly
    return result;
  });
}

/**
 * Признак того, что ключ помечен «секретный» — значение нужно redact'ить
 * целиком, не маскировать.
 */
function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

export const REDACTED = "[REDACTED]";

/**
 * Рекурсивно скрабит payload для PaymentLog:
 *   - Любые секретные ключи → `"[REDACTED]"`.
 *   - Строки с PAN-like последовательностями → маскируются через `maskCardNumber`.
 *   - Объекты/массивы рекурсивно обходятся.
 *   - Прочие типы (number/boolean/null/undefined) пропускаются как есть.
 *
 * Не мутирует исходный объект.
 */
export function scrubPaymentPayload(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((v) => scrubPaymentPayload(v));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        out[key] = REDACTED;
      } else if (typeof value === "string") {
        out[key] = maskCardNumber(value);
      } else {
        out[key] = scrubPaymentPayload(value);
      }
    }
    return out;
  }
  if (typeof input === "string") return maskCardNumber(input);
  return input;
}
