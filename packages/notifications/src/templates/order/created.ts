/**
 * Шаблоны уведомления `order_created` (P4-T10 master-prompt).
 * Триггер: после создания Order (Uniteller webhook=captured или COD-route).
 *
 * Один payload → три формата (SMS/Telegram/Email) × локаль. Локализация
 * через next-intl `createTranslator` + словари `@bigmax/i18n` (намespace
 * `notifications.order.created.*`).
 *
 * **`order_status_changed`** и **`order_delivered`** — отдельные шаблоны для
 * P6-T5/T6 (admin-flow). Здесь не реализованы — добавятся в P6, ключи
 * i18n поднимем тогда же.
 */

import { loadMessages } from "@bigmax/i18n";
import { DEFAULT_LOCALE, formatCurrencyUzs, isLocale, type Locale } from "@bigmax/shared-types";
import { createTranslator } from "next-intl";

export interface OrderCreatedPayload {
  /** `Order.number` в формате BGX-YYYYMMDD-NNNN. */
  orderNumber: string;
  /** Сумма в тийинах — форматируется через `formatCurrencyUzs(locale)` тут же. */
  totalCents: number;
  /** Абсолютный URL success-страницы (`/{locale}/orders/{id}/success`). */
  url: string;
}

export interface OrderCreatedTelegramText {
  title: string;
  body: string;
}

export interface OrderCreatedEmailText {
  subject: string;
  /** Plain-text — построитель оборачивает в минимальный HTML. */
  text: string;
  /** Готовый HTML body (с экранированием значений payload'а). */
  html: string;
}

function resolveLocale(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function getTranslator(rawLocale: string) {
  const locale = resolveLocale(rawLocale);
  const messages = await loadMessages(locale);
  return {
    locale,
    t: createTranslator({ locale, messages, namespace: "notifications.order.created" }),
  };
}

export async function buildOrderCreatedSms(
  rawLocale: string,
  payload: OrderCreatedPayload,
): Promise<string> {
  const { locale, t } = await getTranslator(rawLocale);
  return t("sms", {
    orderNumber: payload.orderNumber,
    total: formatCurrencyUzs(payload.totalCents, locale),
    url: payload.url,
  });
}

export async function buildOrderCreatedTelegram(
  rawLocale: string,
  payload: OrderCreatedPayload,
): Promise<OrderCreatedTelegramText> {
  const { locale, t } = await getTranslator(rawLocale);
  const total = formatCurrencyUzs(payload.totalCents, locale);
  return {
    title: t("telegramTitle"),
    body: t("telegramBody", { orderNumber: payload.orderNumber, total, url: payload.url }),
  };
}

export async function buildOrderCreatedEmail(
  rawLocale: string,
  payload: OrderCreatedPayload,
): Promise<OrderCreatedEmailText> {
  const { locale, t } = await getTranslator(rawLocale);
  const total = formatCurrencyUzs(payload.totalCents, locale);
  const subject = t("emailSubject", { orderNumber: payload.orderNumber });
  const text = t("emailBody", { orderNumber: payload.orderNumber, total, url: payload.url });

  // Минимальный inline-HTML — никаких внешних CSS, всё inline-styled.
  // Email-клиенты (Gmail, Outlook) дружат с этим без танцев. Брендинг
  // (логотип/цвета) — в P8-T5 (PWA + полноценный email-template).
  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <h1 style="font-size: 20px; margin: 0 0 16px 0; color: #ef4444;">Бигмах</h1>
  <p style="font-size: 16px; line-height: 1.5; margin: 0 0 16px 0;">${escapeHtml(text)}</p>
  <p style="margin: 24px 0 0 0;">
    <a href="${escapeHtml(payload.url)}" style="background: #ef4444; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">${escapeHtml(payload.orderNumber)}</a>
  </p>
</body>
</html>`;

  return { subject, text, html };
}

/** Экранирование для подстановки в HTML — защита от XSS в payload-полях. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
