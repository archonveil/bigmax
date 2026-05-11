/**
 * Фабрика Eskiz-клиента. Автоматически выбирает прод-клиент или mock
 * по наличию ESKIZ_EMAIL в окружении — так тесты и dev никогда не
 * дотянутся до реального Eskiz.
 */

import { createEskizClient, type EskizClientConfig } from "./client";
import { createEskizMockClient } from "./mock";
import type { EskizClient } from "./types";

let cached: EskizClient | null = null;

export function getEskizClient(): EskizClient {
  if (cached) return cached;

  const email = process.env["ESKIZ_EMAIL"];
  const password = process.env["ESKIZ_PASSWORD"];
  const sender = process.env["ESKIZ_SENDER"] ?? "BIGMAX";

  if (!email || !password) {
    cached = createEskizMockClient();
    return cached;
  }

  const config: EskizClientConfig = { email, password, sender };
  cached = createEskizClient(config);
  return cached;
}

/** Для тестов — позволяет подставить собственный клиент. */
export function setEskizClientForTesting(client: EskizClient | null): void {
  cached = client;
}

export type { EskizClient, SendSmsInput, SendSmsResult } from "./types";
