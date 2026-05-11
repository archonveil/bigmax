/**
 * Фабрика Resend-клиента. Без `RESEND_API_KEY` → mock в консоль.
 */

import { createResendClient, type ResendClientConfig } from "./client";
import { createResendMockClient } from "./mock";
import type { ResendClient } from "./types";

let cached: ResendClient | null = null;

export function getResendClient(): ResendClient {
  if (cached) return cached;

  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"] ?? "orders@bigmax.uz";

  if (!apiKey || apiKey.trim() === "") {
    cached = createResendMockClient();
    return cached;
  }

  const config: ResendClientConfig = { apiKey, from };
  cached = createResendClient(config);
  return cached;
}

export function setResendClientForTesting(client: ResendClient | null): void {
  cached = client;
}

export type { ResendClient, SendEmailInput, SendEmailResult } from "./types";
export { createResendMockClient } from "./mock";
