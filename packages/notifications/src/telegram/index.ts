/**
 * Фабрика Telegram-клиента. Автоматически выбирает прод-клиент или mock
 * по наличию `TELEGRAM_BOT_TOKEN` — тесты и dev никогда не дотянутся
 * до реального Telegram API.
 */

import { createTelegramClient, type TelegramClientConfig } from "./client";
import { createTelegramMockClient } from "./mock";
import type { TelegramClient } from "./types";

let cached: TelegramClient | null = null;

export function getTelegramClient(): TelegramClient {
  if (cached) return cached;

  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  if (!botToken || botToken.trim() === "") {
    cached = createTelegramMockClient();
    return cached;
  }

  const config: TelegramClientConfig = { botToken };
  cached = createTelegramClient(config);
  return cached;
}

/** Сбрасывает singleton — для тестов. */
export function setTelegramClientForTesting(client: TelegramClient | null): void {
  cached = client;
}

export type { TelegramClient, SendTelegramMessageInput, SendTelegramMessageResult } from "./types";
export { createTelegramMockClient } from "./mock";
