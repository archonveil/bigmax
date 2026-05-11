import { BRAND, LOCALES, DEFAULT_LOCALE, type Locale } from "@bigmax/shared-types";

/**
 * Канонический origin сайта. В prod — https://bigmax.uz (из `BRAND.url`),
 * в dev/staging можно переопределить через `NEXT_PUBLIC_SITE_URL`.
 * Всегда без хвостового слеша.
 */
export function siteUrl(): string {
  const raw = process.env["NEXT_PUBLIC_SITE_URL"]?.trim();
  const url = raw && raw.length > 0 ? raw : BRAND.url;
  return url.replace(/\/+$/, "");
}

/** Нормализованный путь без локали: всегда с ведущим «/», без хвостового. */
function normalizePath(path: string): string {
  if (!path) return "";
  const withLead = path.startsWith("/") ? path : `/${path}`;
  return withLead === "/" ? "" : withLead.replace(/\/+$/, "");
}

/** Абсолютный URL для заданной локали + пути (путь — без локали). */
export function absoluteUrl(path: string, locale: Locale): string {
  const p = normalizePath(path);
  return `${siteUrl()}/${locale}${p}`;
}

/**
 * `<link rel="alternate" hreflang="...">` для всех локалей + `x-default` → ru.
 * Путь — без префикса локали (например, `/catalog/clothing`).
 */
export function languageAlternates(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const l of LOCALES) {
    result[l] = absoluteUrl(path, l);
  }
  result["x-default"] = absoluteUrl(path, DEFAULT_LOCALE);
  return result;
}
