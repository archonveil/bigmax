/**
 * Dev-стаб Eskiz.uz — печатает SMS в консоль, не делает внешних запросов.
 * Используется когда `ESKIZ_EMAIL` пустой (локальная разработка, тесты, CI).
 */

import type { EskizClient, SendSmsInput, SendSmsResult } from "./types";

let mockCounter = 0;

export function createEskizMockClient(options?: { silent?: boolean }): EskizClient {
  const silent = options?.silent ?? false;
  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      mockCounter += 1;
      if (!silent) {
        console.info(
          `[eskiz-mock] → ${input.phone}: ${input.text.replace(/\s+/g, " ").slice(0, 140)}`,
        );
      }
      return { id: `mock-${mockCounter}`, status: "mock" };
    },
  };
}
