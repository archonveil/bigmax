/**
 * next-intl routing — единственный источник правды о локалях на
 * уровне URL. Подключается в middleware, плагине Next.js и навигационных
 * хелперах.
 *
 *   localePrefix: "always" — /ru/..., /uz/..., /en/... Всегда с префиксом.
 */

import { DEFAULT_LOCALE, LOCALES } from "@bigmax/shared-types";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});
