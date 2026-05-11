/**
 * P7-T1 sub-task E: e2e-helpers для работы с Redis-cache.
 *
 * Промо-cache (`promo:v1:<CODE>`, P7-T1 sub-task B) живёт 60s даже после
 * admin CRUD при race с другими тестами. Чтобы e2e не текли друг в друга,
 * перед каждым `test.beforeEach` (или хотя бы перед промо-flow тестом)
 * зовите `clearPromoCache()` — он сделает `SCAN` + `DEL` под глобом
 * `promo:*` (покрывает и текущую версию, и устаревшие).
 *
 * Импорт ленивый (`ioredis` + `getRedis` через `@/server/redis`), чтобы
 * helper не валился, если e2e гоняется без Redis (например, smoke без
 * /api/promo). Любая ошибка глотается — тест продолжит, в худшем случае
 * увидит stale-snapshot до 60s.
 *
 * Использование:
 *   import { clearPromoCache } from "./helpers/redis";
 *
 *   test.beforeEach(async () => {
 *     await clearPromoCache();
 *   });
 */

import { PROMO_CACHE_GLOB } from "../../src/server/promo";
import { getRedis } from "../../src/server/redis";

/**
 * SCAN + DEL под глобом `promo:*`. `SCAN` не блокирует Redis в отличие от
 * `KEYS` — корректно даже если кэш разросся (тесты не разрастят, но
 * паттерн правильный).
 *
 * Безопасен к недоступному Redis — try/catch + silent return.
 */
export async function clearPromoCache(): Promise<void> {
  try {
    const redis = getRedis();
    let cursor = "0";
    do {
      // ioredis: SCAN cursor MATCH pattern COUNT 100
      const [next, keys] = (await redis.scan(cursor, "MATCH", PROMO_CACHE_GLOB, "COUNT", 100)) as [
        string,
        string[],
      ];
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Redis недоступен — silent. Тест-уровень: лучше тихий no-op чем
    // падение beforeEach, особенно когда тест не зависит от промо-cache.
  }
}

/**
 * Универсальный flush под произвольным glob'ом. Не экспортируется наружу
 * package'а — оставляем для будущих helpers (loyalty-cache в P7-T2 и т.п.).
 */
export async function clearByGlob(globPattern: string): Promise<void> {
  try {
    const redis = getRedis();
    let cursor = "0";
    do {
      const [next, keys] = (await redis.scan(cursor, "MATCH", globPattern, "COUNT", 100)) as [
        string,
        string[],
      ];
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // see above
  }
}
