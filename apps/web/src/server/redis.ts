/**
 * Redis singleton с ленивой инициализацией.
 *
 * Next.js при `next build` пробует рендерить API-маршруты, что импортирует
 * этот модуль; если REDIS_URL на момент сборки не задан — падаем. Поэтому
 * создание клиента откладываем до первого вызова `getRedis()`.
 */

import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { bigmaxRedis: Redis | undefined };

export function getRedis(): Redis {
  if (globalForRedis.bigmaxRedis) return globalForRedis.bigmaxRedis;

  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL is not set. See .env.example.");
  }

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  if (process.env["NODE_ENV"] !== "production") {
    globalForRedis.bigmaxRedis = client;
  }
  return client;
}
