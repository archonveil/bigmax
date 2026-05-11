/**
 * Singleton ioredis-клиент для BullMQ. BullMQ требует `maxRetriesPerRequest:
 * null` (см. https://docs.bullmq.io/guide/connections), иначе блокирующие
 * команды падают с TimeoutError.
 */

import IORedis from "ioredis";

let client: IORedis | undefined;

export function getRedisConnection(): IORedis {
  if (client) return client;
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL is not set; worker requires Redis.");
  }
  client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  return client;
}
