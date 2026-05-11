/**
 * Eskiz.uz — узбекский SMS-провайдер. Используется для OTP и транзакционных
 * уведомлений. Документация: https://documenter.getpostman.com/view/663428/RzfmES4z
 */

export interface SendSmsInput {
  /** E.164 узбекский формат: +998XXXXXXXXX. */
  phone: string;
  /** Текст SMS, лимит Eskiz — 160 символов для Latin / 70 для Unicode. */
  text: string;
}

export interface SendSmsResult {
  /** Провайдерский id сообщения (в моке генерируется локально). */
  id: string;
  /** "waiting" — обычно отвечает Eskiz; "mock" — dev-стаб. */
  status: "waiting" | "mock";
}

export interface EskizClient {
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}
