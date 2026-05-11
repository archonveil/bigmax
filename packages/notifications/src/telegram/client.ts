/**
 * Production Telegram Bot client. Простой fetch на `sendMessage` API —
 * лимит трафика низкий (десятки сообщений в минуту максимум для уведомлений
 * Бигмах), поэтому полная node-telegram-bot-api не нужна.
 *
 * Документация: https://core.telegram.org/bots/api#sendmessage
 */

import type { SendTelegramMessageInput, SendTelegramMessageResult, TelegramClient } from "./types";

export interface TelegramClientConfig {
  /** Bot token из @BotFather. */
  botToken: string;
  /** Дефолтный timeout сетевого запроса в мс. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10_000;

export function createTelegramClient(config: TelegramClientConfig): TelegramClient {
  const baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;

  return {
    async sendMessage(input: SendTelegramMessageInput): Promise<SendTelegramMessageResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
            ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
            ...(input.disableNotification ? { disable_notification: true } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Telegram sendMessage ${res.status}: ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as { ok: boolean; result?: { message_id: number } };
        if (!json.ok || !json.result) {
          throw new Error(`Telegram sendMessage returned not-ok payload`);
        }
        return { messageId: json.result.message_id, status: "ok" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
