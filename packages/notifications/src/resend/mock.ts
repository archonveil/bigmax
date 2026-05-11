/**
 * Dev-стаб Resend — печатает email в консоль, не отправляет ничего.
 * Используется когда `RESEND_API_KEY` пустой.
 */

import type { ResendClient, SendEmailInput, SendEmailResult } from "./types";

let mockCounter = 0;

export function createResendMockClient(options?: { silent?: boolean }): ResendClient {
  const silent = options?.silent ?? false;
  return {
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      mockCounter += 1;
      if (!silent) {
        const to = Array.isArray(input.to) ? input.to.join(", ") : input.to;
        console.info(`[resend-mock] → ${to}: ${input.subject}`);
      }
      return { id: `mock-${mockCounter}`, status: "mock" };
    },
  };
}
