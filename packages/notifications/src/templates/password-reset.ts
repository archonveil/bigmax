/**
 * P6-T8 follow-up (closes (b)): email-шаблон для self-service password
 * reset. Локализован через @bigmax/i18n createTranslator.
 *
 * Возвращает `{subject, html, text}` — caller (`Resend.sendEmail`) шлёт
 * оба формата, текстовый — fallback для plain-text-only клиентов.
 *
 * **NB**: ссылка не должна логироваться в Sentry/PaymentLog — содержит
 * plain-token. Caller-route отвечает за это.
 */

import { loadMessages } from "@bigmax/i18n";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@bigmax/shared-types";
import { createTranslator } from "next-intl";

export interface PasswordResetEmailInput {
  rawLocale: string;
  email: string;
  /** Полная URL: `https://bigmax.uz/{locale}/auth/password-reset/${token}`. */
  resetUrl: string;
}

export interface PasswordResetEmailOutput {
  subject: string;
  html: string;
  text: string;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function buildPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<PasswordResetEmailOutput> {
  const locale: Locale = isLocale(input.rawLocale) ? input.rawLocale : DEFAULT_LOCALE;
  const messages = await loadMessages(locale);
  const t = createTranslator({
    locale,
    messages,
    namespace: "auth.passwordReset.email",
  });

  const subject = t("subject");
  const greeting = t("greeting");
  const intro = t("intro", { email: input.email });
  const cta = t("cta");
  const expiry = t("expiry");
  const ignore = t("ignore");
  const footer = t("footer");

  const text = [
    greeting,
    "",
    intro,
    "",
    cta + ":",
    input.resetUrl,
    "",
    expiry,
    "",
    ignore,
    "",
    footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a; background: #ffffff;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">${escape(greeting)}</h1>
  <p style="line-height: 1.6;">${escape(intro)}</p>
  <p style="margin: 24px 0;">
    <a href="${escape(input.resetUrl)}" style="display: inline-block; background: #0ea5e9; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">${escape(cta)}</a>
  </p>
  <p style="font-size: 14px; color: #64748b;">${escape(expiry)}</p>
  <p style="font-size: 14px; color: #64748b;">${escape(ignore)}</p>
  <hr style="margin: 32px 0; border: none; border-top: 1px solid #e2e8f0;" />
  <p style="font-size: 12px; color: #94a3b8; white-space: pre-line;">${escape(footer)}</p>
</body>
</html>`;

  return { subject, html, text };
}
