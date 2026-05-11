/**
 * `enqueueNotification` — публичный helper для постановки уведомления в
 * BullMQ-очередь `notifications`. Импортируется и из web (webhook + COD-
 * route), и из admin-flow в P6.
 *
 * Зачем здесь, а не в `apps/worker/`: web-приложение не должно зависеть от
 * worker-package'а (циклическая абстракция). Очередь — общий ресурс, её
 * helper живёт в `@bigmax/notifications`.
 *
 * Connection lazy: `getNotificationQueue()` создаёт `Queue` на первом
 * вызове, переиспользует. В тестах `setNotificationQueueForTesting`
 * подменяет на мок.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

import type { NotificationChannel, NotificationRecipient } from "./service";
import type { OrderCreatedPayload } from "./templates/order/created";

export const NOTIFICATIONS_QUEUE_NAME = "notifications";

// Внутренний тип job'а — у service.ts его нет (зависимость notifications →
// worker недопустима), поэтому держим отдельный SHape'у.
interface NotificationJobPayloadShape {
  type: "order_created";
  recipient: NotificationRecipient;
  channels: NotificationChannel[];
  payload: OrderCreatedPayload;
}

let cachedQueue: Queue | null = null;
let cachedConnection: IORedis | null = null;

interface QueueLike {
  add: (
    name: string,
    data: NotificationJobPayloadShape,
    opts?: {
      removeOnComplete?: number;
      removeOnFail?: number;
      attempts?: number;
      backoff?: { type: string; delay: number };
    },
  ) => Promise<unknown>;
  close: () => Promise<void>;
}

let testQueueOverride: QueueLike | null = null;

export function getNotificationQueue(): QueueLike {
  if (testQueueOverride) return testQueueOverride;
  if (cachedQueue) return cachedQueue as unknown as QueueLike;

  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL is not set; notifications queue requires Redis.");
  }
  cachedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  cachedQueue = new Queue(NOTIFICATIONS_QUEUE_NAME, { connection: cachedConnection });
  return cachedQueue as unknown as QueueLike;
}

export function setNotificationQueueForTesting(q: QueueLike | null): void {
  testQueueOverride = q;
}

export async function closeNotificationQueue(): Promise<void> {
  if (cachedQueue) await cachedQueue.close();
  if (cachedConnection) await cachedConnection.quit().catch(() => {});
  cachedQueue = null;
  cachedConnection = null;
}

/**
 * Кладёт `order_created` job в очередь. Не дожидается обработки (fire-and-
 * forget) — это нужно вызывающему коду (webhook / COD-route): отправка
 * уведомлений не должна блокировать ответ клиенту/Uniteller.
 */
export async function enqueueOrderCreatedNotification(
  input: Omit<NotificationJobPayloadShape, "type">,
): Promise<void> {
  const queue = getNotificationQueue();
  await queue.add(
    "order_created",
    { type: "order_created", ...input },
    {
      // BullMQ delete-after-N-keep — экономим Redis-память при большом потоке.
      removeOnComplete: 1000,
      removeOnFail: 1000,
      // 3 попытки с экспоненциальным backoff: 1с / 4с / 16с. Сетевые сбои
      // SMS/Telegram/Resend часто требуют retry, не валим юзера.
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  );
}

export type { NotificationJobPayloadShape };
