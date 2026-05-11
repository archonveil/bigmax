/**
 * Деньги — integer в тийнах (UZS × 100). Никогда не использовать float.
 *
 * Форматы вывода (спека 4.7):
 *   ru → "1 500 000 сум"
 *   uz → "1 500 000 so'm"
 *   en → "1,500,000 UZS"
 *
 * Для Uniteller `Subtotal_P` — decimal UZS с двумя знаками после точки:
 *   `centsToDecimalString(1500000)` → "15000.00"
 */

import type { Locale } from "./locales";

const NBSP = " ";

export function centsToSum(cents: number): number {
  return Math.floor(cents / 100);
}

export function sumToCents(sum: number): number {
  return Math.round(sum * 100);
}

/**
 * Тийны → строка "X.YY" для передачи в Uniteller Subtotal_P.
 * Используется неразрывный формат без разделителей тысяч.
 */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`centsToDecimalString: expected non-negative integer, got ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export interface FormatCurrencyOptions {
  /**
   * Управление знаком. Совпадает с `Intl.NumberFormat.signDisplay`.
   *   - `auto` (по-умолчанию): минус только для отрицательных.
   *   - `always`: `+100 / −100`.
   *   - `never`: без знака вообще.
   *   - `exceptZero`: как `always`, но 0 без знака.
   * Для display-отрицательного discount'а: передавайте `discountCents > 0`
   * и `{ signDisplay: "never" }` с префиксом «− » вручную, либо
   * `-discountCents` и `{ signDisplay: "always" }` — оба варианта работают.
   */
  signDisplay?: "auto" | "always" | "never" | "exceptZero";
}

/**
 * Форматирует сумму в тийнах как строку валюты для указанной локали.
 * Sign в Intl.NumberFormat выдаёт именно minus-sign U+2212 («−») для ru/en,
 * что семантически корректнее ASCII «-» для валют.
 */
export function formatCurrencyUzs(
  cents: number,
  locale: Locale,
  options: FormatCurrencyOptions = {},
): string {
  const sum = centsToSum(cents);
  const intlOpts: Intl.NumberFormatOptions = {};
  if (options.signDisplay) intlOpts.signDisplay = options.signDisplay;

  if (locale === "en") {
    const formatted = new Intl.NumberFormat("en-US", intlOpts).format(sum);
    return `${formatted}${NBSP}UZS`;
  }
  // ru / uz — одинаковые разделители (пробел), меняется только суффикс.
  const formatted = new Intl.NumberFormat("ru-RU", intlOpts).format(sum);
  const suffix = locale === "uz" ? "so'm" : "сум";
  return `${formatted}${NBSP}${suffix}`;
}
