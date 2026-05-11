/**
 * Resend (email) — отправка транзакционных писем с домена bigmax.uz.
 * Документация: https://resend.com/docs/api-reference/emails/send-email
 */

export interface SendEmailInput {
  /** Получатель (один или несколько). */
  to: string | string[];
  /** Заголовок письма. */
  subject: string;
  /** HTML-тело. */
  html: string;
  /** Plain-text fallback (Gmail-friendly). Если не задан, derive из html. */
  text?: string;
}

export interface SendEmailResult {
  /** Resend email id; в моке — сгенерированный. */
  id: string;
  /** "ok" — отправлено в Resend; "mock" — dev-стаб. */
  status: "ok" | "mock";
}

export interface ResendClient {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
