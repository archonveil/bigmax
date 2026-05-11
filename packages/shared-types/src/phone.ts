/**
 * Узбекские телефоны. Каноническая форма — E.164: `+998XXXXXXXXX` (12 символов).
 * Формат для отображения (спека 4.7): `+998 XX XXX-XX-XX`.
 */

/** Проверяет, что строка — узбекский телефон в E.164 (+998 + 9 цифр). */
export const UZ_PHONE_REGEX = /^\+998\d{9}$/;

function extractNineDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const rest = digits.startsWith("998") ? digits.slice(3) : digits;
  return rest.length === 9 ? rest : null;
}

/**
 * Нормализует любой узбекский номер в E.164 `+998XXXXXXXXX`.
 * Возвращает null, если строка не содержит 9 значащих цифр.
 */
export function toE164(phone: string): string | null {
  const rest = extractNineDigits(phone);
  return rest === null ? null : `+998${rest}`;
}

/**
 * Форматирует номер для отображения: `+998 90 123-45-67`.
 * Если вход не парсится — возвращает вход как есть.
 */
export function formatPhone(phone: string): string {
  const rest = extractNineDigits(phone);
  if (rest === null) return phone;
  return `+998 ${rest.slice(0, 2)} ${rest.slice(2, 5)}-${rest.slice(5, 7)}-${rest.slice(7)}`;
}

/** Проверяет канонический E.164 формат без нормализации. */
export function isValidUzPhone(phone: string): boolean {
  return UZ_PHONE_REGEX.test(phone);
}
