/**
 * Локали и хелпер для мультиязычных полей Prisma.
 *
 * Правила:
 *   - Ровно три локали: ru (default), uz, en.
 *   - БД хранит денормализованные колонки `*Ru / *Uz / *En` (Prisma camelCase).
 *   - Fallback всегда на `ru`.
 */

export const LOCALES = ["ru", "uz", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

export const LOCALE_LABELS: Record<Locale, string> = {
  ru: "Русский",
  uz: "O'zbekcha",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

type Capitalize<S extends string> = S extends `${infer First}${infer Rest}`
  ? `${Uppercase<First>}${Rest}`
  : S;

/**
 * Возвращает значение мультиязычного поля с fallback на `ru`.
 *
 * @example
 *   localized(product, "name", "uz")
 *   // читает product.nameUz, при отсутствии → product.nameRu
 */
export function localized<
  Field extends string,
  Obj extends Partial<Record<`${Field}${Capitalize<Locale>}`, string | null>>,
>(obj: Obj, field: Field, locale: Locale): string {
  const suffix = (locale[0]!.toUpperCase() + locale.slice(1)) as Capitalize<Locale>;
  const primaryKey = `${field}${suffix}` as keyof Obj;
  const primary = obj[primaryKey];
  if (typeof primary === "string" && primary.length > 0) return primary;

  const fallbackKey = `${field}Ru` as keyof Obj;
  const fallback = obj[fallbackKey];
  return typeof fallback === "string" ? fallback : "";
}
