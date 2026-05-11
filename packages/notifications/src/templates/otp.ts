/**
 * OTP-шаблон SMS. Рендерит строку `sms.otpCode` из словарей
 * @bigmax/i18n через next-intl createTranslator (ICU-интерполяция `{code}`).
 *
 * Fallback на ru, если локаль отсутствует.
 */

import { loadMessages } from "@bigmax/i18n";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@bigmax/shared-types";
import { createTranslator } from "next-intl";

export async function buildOtpSmsText(rawLocale: string, code: string): Promise<string> {
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "sms" });
  return t("otpCode", { code });
}
