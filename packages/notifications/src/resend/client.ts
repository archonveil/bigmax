/**
 * Production Resend client. Простой fetch на /emails endpoint — низкий
 * QPS уведомлений Бигмах не требует SDK.
 *
 * Документация: https://resend.com/docs/api-reference/emails/send-email
 */

import type { ResendClient, SendEmailInput, SendEmailResult } from "./types";

export interface ResendClientConfig {
  /** API key из Resend. */
  apiKey: string;
  /** From-адрес (`orders@bigmax.uz`). */
  from: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 15_000;
const ENDPOINT = "https://api.resend.com/emails";

export function createResendClient(config: ResendClientConfig): ResendClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;

  return {
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            from: config.from,
            to: Array.isArray(input.to) ? input.to : [input.to],
            subject: input.subject,
            html: input.html,
            ...(input.text ? { text: input.text } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as { id?: string };
        if (!json.id) throw new Error("Resend response missing id");
        return { id: json.id, status: "ok" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
