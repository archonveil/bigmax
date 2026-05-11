/**
 * Формат номера заказа Бигмах: `BGX-YYYYMMDD-NNNN`.
 *
 * Используется как `Order_IDP` в платежах Uniteller (раздел 5.4 спеки).
 * Дата берётся в UTC (предсказуемо для фоновых задач и webhook'ов).
 * Порядковый номер NNNN — 0001..9999 в пределах одного дня.
 */

import { BRAND } from "./brand";

export const ORDER_NUMBER_PATTERN = /^BGX-(\d{4})(\d{2})(\d{2})-(\d{4})$/;

export interface OrderNumberParts {
  year: number;
  month: number;
  day: number;
  sequence: number;
}

export function buildOrderNumber(date: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new RangeError(`buildOrderNumber: sequence must be integer 1..9999, got ${sequence}`);
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const nnnn = String(sequence).padStart(4, "0");
  return `${BRAND.orderNumberPrefix}-${yyyy}${mm}${dd}-${nnnn}`;
}

export function parseOrderNumber(input: string): OrderNumberParts | null {
  const match = ORDER_NUMBER_PATTERN.exec(input);
  if (!match) return null;
  const [, y, m, d, n] = match;
  return {
    year: Number(y),
    month: Number(m),
    day: Number(d),
    sequence: Number(n),
  };
}

export function isOrderNumber(input: string): boolean {
  return ORDER_NUMBER_PATTERN.test(input);
}
