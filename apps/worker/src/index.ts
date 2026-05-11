/**
 * Bigmax worker entrypoint.
 *
 * Регистрирует BullMQ Queue + Worker для двух очередей:
 *   - `uniteller-pull` (P4-T9) — repeatable cron `check-pending-payments`
 *     раз в минуту: pull-проверка зависших платежей.
 *   - `notifications` (P4-T10) — обрабатывает enqueue'нутые `order_created`
 *     (и в будущем `order_status_changed`/`order_delivered`).
 *
 * Worker выполняется как long-running Node-процесс (отдельный контейнер от
 * Next.js). См. `apps/worker/Dockerfile` + `docker compose --profile worker up`.
 *
 * **Запуск (dev):**  `pnpm --filter @bigmax/worker run dev`
 * **Запуск (prod):** `pnpm --filter @bigmax/worker run start`.
 */

import { prisma } from "@bigmax/db";
import {
  getEskizClient,
  getResendClient,
  getTelegramClient,
  NOTIFICATIONS_QUEUE_NAME,
} from "@bigmax/notifications";
import { fetchPaymentStatus } from "@bigmax/payments/uniteller";
import { Queue, Worker, type Job } from "bullmq";

import { checkPendingPaymentsJob, type JobResult } from "./jobs/check-pending-payments";
import { notificationJob, type NotificationJobPayload } from "./jobs/notification";
import { reportError } from "./observability";
import { getRedisConnection } from "./redis";

const PULL_QUEUE = "uniteller-pull";
const PULL_REPEATABLE_JOB = "check-pending-payments";
const POLL_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const connection = getRedisConnection();

  // ---------------------------------------------------------------------
  // Queue 1: uniteller-pull (P4-T9)
  // ---------------------------------------------------------------------
  const pullQueue = new Queue(PULL_QUEUE, { connection });

  // Чистим прошлые регистрации (на случай изменения интервала) и регистрируем заново.
  const repeatables = await pullQueue.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.name === PULL_REPEATABLE_JOB) {
      await pullQueue.removeRepeatableByKey(r.key);
    }
  }
  await pullQueue.add(
    PULL_REPEATABLE_JOB,
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
  console.info(
    `[worker] queue=${PULL_QUEUE} repeatable=${PULL_REPEATABLE_JOB} every=${POLL_INTERVAL_MS}ms`,
  );

  const shopId = process.env["UNITELLER_SHOP_ID"] ?? "";
  const authLogin = process.env["UNITELLER_AUTH_LOGIN"] ?? "";
  const authPassword = process.env["UNITELLER_AUTH_PASSWORD"] ?? "";

  const pullWorker = new Worker(
    PULL_QUEUE,
    async (job: Job): Promise<JobResult> => {
      if (shopId === "" || authLogin === "" || authPassword === "") {
        console.warn(`[worker] skip ${job.name}: UNITELLER_* not configured`);
        return { scanned: 0, captured: 0, failed: 0, cancelled: 0, errors: 0 };
      }

      const result = await checkPendingPaymentsJob({
        prisma,
        fetchStatus: (orderId) => fetchPaymentStatus({ orderId, shopId, authLogin, authPassword }),
        now: () => new Date(),
      });
      console.info(
        `[worker] ${job.name} scanned=${result.scanned} captured=${result.captured} failed=${result.failed} cancelled=${result.cancelled} errors=${result.errors}`,
      );
      return result;
    },
    { connection, concurrency: 1 },
  );

  // ---------------------------------------------------------------------
  // Queue 2: notifications (P4-T10)
  // ---------------------------------------------------------------------
  const notificationsWorker = new Worker(
    NOTIFICATIONS_QUEUE_NAME,
    async (job: Job<NotificationJobPayload>) => {
      const result = await notificationJob(
        {
          prisma,
          eskiz: getEskizClient(),
          telegram: getTelegramClient(),
          resend: getResendClient(),
        },
        job.data,
      );
      console.info(
        `[worker] ${job.name} type=${result.type} channels=${result.channels} ok=${result.ok} failed=${result.failed}`,
      );
      return result;
    },
    // SMS/Telegram/Resend отправки независимы → можем параллельно несколько
    // job'ов, не вступаем в гонку с pull-проверкой Uniteller (та serialized).
    { connection, concurrency: 5 },
  );

  console.info(`[worker] queue=${NOTIFICATIONS_QUEUE_NAME} concurrency=5`);

  // ---------------------------------------------------------------------
  // Shared listeners + shutdown
  // ---------------------------------------------------------------------
  for (const w of [pullWorker, notificationsWorker]) {
    w.on("failed", (job, err) => {
      reportError(err, {
        scope: "worker.bullmq.failed",
        extra: { jobId: job?.id, jobName: job?.name, queue: w.name },
      });
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[worker] received ${signal}, shutting down`);
    await Promise.all([pullWorker.close(), notificationsWorker.close()]);
    await pullQueue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info("[worker] ready");
}

void main().catch((err) => {
  reportError(err, { scope: "worker.fatal" });
  process.exit(1);
});
