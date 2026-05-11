/**
 * Dev-стаб Telegram Bot API — печатает сообщение в консоль, не ходит
 * на api.telegram.org. Используется когда `TELEGRAM_BOT_TOKEN` не задан
 * (CI, dev, e2e).
 */

import type { SendTelegramMessageInput, SendTelegramMessageResult, TelegramClient } from "./types";

let mockCounter = 0;

export function createTelegramMockClient(options?: { silent?: boolean }): TelegramClient {
  const silent = options?.silent ?? false;
  return {
    async sendMessage(input: SendTelegramMessageInput): Promise<SendTelegramMessageResult> {
      mockCounter += 1;
      if (!silent) {
        console.info(
          `[telegram-mock] → ${input.chatId}: ${input.text.replace(/\s+/g, " ").slice(0, 200)}`,
        );
      }
      return { messageId: mockCounter, status: "mock" };
    },
  };
}
