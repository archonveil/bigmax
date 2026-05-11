/**
 * Справочник регионов Узбекистана (14 единиц: Каракалпакстан + 12 вилоятов
 * + Ташкент как отдельная городская единица + Ташкентская область).
 *
 * Хранится как const вместо таблицы в БД: справочник меняется редко
 * (административные реформы — раз в годы), типобезопасен на этапе
 * компиляции и не требует миграций для обновления.
 *
 * В БД в `Address.region` сохраняется `slug` (например "tashkent-city").
 * Для отображения: `regionName(slug, locale)`.
 */

import type { Locale } from "./locales";

export interface UzRegion {
  readonly slug: string;
  readonly nameRu: string;
  readonly nameUz: string;
  readonly nameEn: string;
}

export const UZ_REGIONS: readonly UzRegion[] = [
  { slug: "tashkent-city", nameRu: "Ташкент", nameUz: "Toshkent", nameEn: "Tashkent" },
  {
    slug: "tashkent-region",
    nameRu: "Ташкентская область",
    nameUz: "Toshkent viloyati",
    nameEn: "Tashkent Region",
  },
  {
    slug: "karakalpakstan",
    nameRu: "Каракалпакстан",
    nameUz: "Qoraqalpog'iston",
    nameEn: "Karakalpakstan",
  },
  { slug: "andijan", nameRu: "Андижан", nameUz: "Andijon", nameEn: "Andijan" },
  { slug: "bukhara", nameRu: "Бухара", nameUz: "Buxoro", nameEn: "Bukhara" },
  { slug: "fergana", nameRu: "Фергана", nameUz: "Farg'ona", nameEn: "Fergana" },
  { slug: "jizzakh", nameRu: "Джизак", nameUz: "Jizzax", nameEn: "Jizzakh" },
  {
    slug: "qashqadaryo",
    nameRu: "Кашкадарья",
    nameUz: "Qashqadaryo",
    nameEn: "Qashqadaryo",
  },
  { slug: "khorezm", nameRu: "Хорезм", nameUz: "Xorazm", nameEn: "Khorezm" },
  { slug: "namangan", nameRu: "Наманган", nameUz: "Namangan", nameEn: "Namangan" },
  { slug: "navoiy", nameRu: "Навои", nameUz: "Navoiy", nameEn: "Navoiy" },
  { slug: "samarkand", nameRu: "Самарканд", nameUz: "Samarqand", nameEn: "Samarkand" },
  { slug: "sirdaryo", nameRu: "Сырдарья", nameUz: "Sirdaryo", nameEn: "Sirdaryo" },
  {
    slug: "surxondaryo",
    nameRu: "Сурхандарья",
    nameUz: "Surxondaryo",
    nameEn: "Surxondaryo",
  },
] as const;

export const UZ_REGION_SLUGS: readonly string[] = UZ_REGIONS.map((r) => r.slug);

export const TASHKENT_CITY_SLUG = "tashkent-city";

/** 11 районов (тумани) города Ташкента. */
export const TASHKENT_DISTRICTS: readonly UzRegion[] = [
  { slug: "bektemir", nameRu: "Бектемирский", nameUz: "Bektemir", nameEn: "Bektemir" },
  { slug: "chilonzor", nameRu: "Чиланзарский", nameUz: "Chilonzor", nameEn: "Chilanzar" },
  { slug: "mirobod", nameRu: "Мирабадский", nameUz: "Mirobod", nameEn: "Mirobod" },
  {
    slug: "mirzo-ulugbek",
    nameRu: "Мирзо-Улугбекский",
    nameUz: "Mirzo Ulug'bek",
    nameEn: "Mirzo Ulugbek",
  },
  { slug: "olmazor", nameRu: "Алмазарский", nameUz: "Olmazor", nameEn: "Olmazor" },
  { slug: "sergeli", nameRu: "Сергелийский", nameUz: "Sergeli", nameEn: "Sergeli" },
  {
    slug: "shayxontohur",
    nameRu: "Шайхантахурский",
    nameUz: "Shayxontohur",
    nameEn: "Shaykhantakhur",
  },
  { slug: "uchtepa", nameRu: "Учтепинский", nameUz: "Uchtepa", nameEn: "Uchtepa" },
  { slug: "yakkasaroy", nameRu: "Яккасарайский", nameUz: "Yakkasaroy", nameEn: "Yakkasaroy" },
  { slug: "yashnobod", nameRu: "Яшнабадский", nameUz: "Yashnobod", nameEn: "Yashnabad" },
  { slug: "yunusobod", nameRu: "Юнусабадский", nameUz: "Yunusobod", nameEn: "Yunusabad" },
] as const;

export function isUzRegionSlug(value: unknown): value is string {
  return typeof value === "string" && UZ_REGION_SLUGS.includes(value);
}

export function findRegion(slug: string): UzRegion | undefined {
  return UZ_REGIONS.find((r) => r.slug === slug);
}

export function regionName(slug: string, locale: Locale): string {
  const region = findRegion(slug);
  if (!region) return slug;
  if (locale === "uz") return region.nameUz;
  if (locale === "en") return region.nameEn;
  return region.nameRu;
}

export function districtName(slug: string, locale: Locale): string {
  const d = TASHKENT_DISTRICTS.find((x) => x.slug === slug);
  if (!d) return slug;
  if (locale === "uz") return d.nameUz;
  if (locale === "en") return d.nameEn;
  return d.nameRu;
}

/** Максимум сохранённых адресов на одного пользователя. */
export const MAX_ADDRESSES_PER_USER = 10;
