/**
 * Ленивый загрузчик словарей. Используется в `getRequestConfig` и
 * везде, где нужны сообщения на языке пользователя (например, в
 * @bigmax/notifications для SMS/Telegram/email шаблонов).
 *
 * Динамический import позволяет бандлеру (Next.js/webpack) включать
 * только запрошенный словарь в рантайме.
 */

import type { Locale } from "@bigmax/shared-types";
import type { AbstractIntlMessages } from "next-intl";

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const mod = (await import(`../messages/${locale}.json`)) as {
    default: AbstractIntlMessages;
  };
  return mod.default;
}
