/**
 * `notificationJob` — BullMQ-handler для очереди `notifications` (P4-T10).
 *
 * Принимает payload от триггера (web webhook captured / COD-route success),
 * делегирует в `sendOrderCreated` из `@bigmax/notifications` и пишет
 * `Notification`-row для каждого канала. Pure async с DI на клиентах
 * (`prisma`, `eskiz`, `telegram`, `resend`) — тесты подменяют через моки.
 *
 * **Не делает retry внутри** — BullMQ-worker делает этот retry на уровне
 * job'а; здесь только одна попытка отправки + запись результата.
 */

import {
  sendOrderCreated,
  type NotificationServiceClients,
  type SendOrderCreatedInput,
} from "@bigmax/notifications";

import { reportError } from "../observability";

export interface NotificationJobPayload extends SendOrderCreatedInput {
  type: "order_created";
}

export interface NotificationJobResult {
  type: string;
  channels: number;
  ok: number;
  failed: number;
}

export async function notificationJob(
  clients: NotificationServiceClients,
  payload: NotificationJobPayload,
): Promise<NotificationJobResult> {
  if (payload.type !== "order_created") {
    // P4-T10 реализует только order_created. order_status_changed и
    // order_delivered — в P6-T5/T6.
    return { type: payload.type, channels: 0, ok: 0, failed: 0 };
  }

  const results = await sendOrderCreated(clients, {
    recipient: payload.recipient,
    channels: payload.channels,
    payload: payload.payload,
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  if (failed > 0) {
    reportError(new Error(`notification partial failure: ${failed}/${results.length}`), {
      scope: "worker.notification",
      extra: {
        type: payload.type,
        userId: payload.recipient.userId,
        results: results.map((r) => ({ channel: r.channel, ok: r.ok, error: r.error })),
      },
    });
  }
  return { type: payload.type, channels: results.length, ok, failed };
}
