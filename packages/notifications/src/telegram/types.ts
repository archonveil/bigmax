/**
 * Telegram Bot API — bot @bigmax_shop_bot шлёт уведомления юзеру (в личку,
 * `chatId = User.telegram_chat_id` после линковки) и постит в админ-канал
 * @bigmax_uz при ключевых событиях (чужой канал — отдельный chatId).
 *
 * Документация: https://core.telegram.org/bots/api#sendmessage
 */

export interface SendTelegramMessageInput {
  /** Числовой chatId или `@username`. */
  chatId: string | number;
  /** Текст сообщения. Telegram-лимит 4096 символов. */
  text: string;
  /** `Markdown` / `MarkdownV2` / `HTML`. По-умолчанию без форматирования. */
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  /** Не пиликать у пользователя. Полезно для админских низкоприоритетных. */
  disableNotification?: boolean;
}

export interface SendTelegramMessageResult {
  /** Telegram message_id из ответа API; в моке генерируется локально. */
  messageId: number;
  /** "ok" — реальная отправка; "mock" — dev-стаб. */
  status: "ok" | "mock";
}

export interface TelegramClient {
  sendMessage(input: SendTelegramMessageInput): Promise<SendTelegramMessageResult>;
}
