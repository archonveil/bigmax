/**
 * next-intl getRequestConfig — вызывается на каждом запросе в Server
 * Components / Route Handlers. Возвращает локаль и словарь, которые
 * далее доступны через `getTranslations()` / `getMessages()`.
 *
 * Точка входа указана в `next.config.mjs` через `createNextIntlPlugin`.
 */

import { loadMessages } from "@bigmax/i18n";
import { routing } from "@bigmax/i18n/routing";
import { isLocale } from "@bigmax/shared-types";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
