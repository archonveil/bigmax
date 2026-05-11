/**
 * BullMQ live-smoke для P4-T9 sub-task G.
 *
 * Проверяет что Queue + Worker на реальном Redis действительно подключаются,
 * принимают one-shot job и вызывают handler. Не подключаем сюда orchestrator
 * (его покрывает unit + integration test'ы) — здесь именно plumbing-проверка
 * BullMQ, чтобы поймать регрессии типа неправильного `connection`-config'а
 * или мисматча версий.
 *
 * Skip-логика: `describe.skipIf(!REDIS_URL)` — если Redis не доступен,
 * тесты пропускаются. На CI/dev с поднятым `docker:up` они выполнятся.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const REDIS_URL = process.env["REDIS_URL"];
const TEST_QUEUE_NAME = `bigmax-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!REDIS_URL)("BullMQ live smoke", () => {
  // Создаём отдельные connection'ы — BullMQ требует, чтобы у Queue и Worker
  // были разные connection-объекты (один не может одновременно слать команды
  // и блокирующе слушать).
  const queueConnection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
  const workerConnection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
  const queue = new Queue(TEST_QUEUE_NAME, { connection: queueConnection });

  afterAll(async () => {
    await queue.close();
    await queueConnection.quit().catch(() => {});
    await workerConnection.quit().catch(() => {});
  });

  it("Worker обрабатывает one-shot job и резолвит payload", async () => {
    let processedJobName = "";
    let resolveProcessed!: (v: { name: string; data: { x: number } }) => void;
    const processedPromise = new Promise<{ name: string; data: { x: number } }>((resolve) => {
      resolveProcessed = resolve;
    });
    const w = new Worker<{ x: number }>(
      TEST_QUEUE_NAME,
      async (job: Job<{ x: number }>) => {
        processedJobName = job.name;
        resolveProcessed({ name: job.name, data: job.data });
        return { ok: true, doubled: job.data.x * 2 };
      },
      { connection: workerConnection, concurrency: 1 },
    );

    try {
      const job = await queue.add("smoke-job", { x: 21 }, { removeOnComplete: true });
      expect(job.id).toBeDefined();

      const result = await Promise.race([
        processedPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("BullMQ smoke timeout (10s)")), 10_000),
        ),
      ]);
      expect(result.data.x).toBe(21);
      expect(processedJobName).toBe("smoke-job");
    } finally {
      await w.close();
    }
  });

  it("Queue регистрирует repeatable job (контракт production-кода)", async () => {
    // Удаляем старые repeatables (на случай повторного запуска теста).
    const before = await queue.getRepeatableJobs();
    for (const r of before) {
      if (r.name === "smoke-repeatable") await queue.removeRepeatableByKey(r.key);
    }

    await queue.add("smoke-repeatable", {}, { repeat: { every: 60_000 } });
    const after = await queue.getRepeatableJobs();
    const ours = after.find((r) => r.name === "smoke-repeatable");
    expect(ours).toBeDefined();
    // BullMQ возвращает `every` как string в свежих версиях — приводим к number.
    expect(Number(ours!.every)).toBe(60_000);

    // Cleanup — иначе накапливаются между тест-прогонами.
    if (ours) await queue.removeRepeatableByKey(ours.key);
  });
});
