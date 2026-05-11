/**
 * Redis-based fixed-window rate limiter.
 *
 * Pattern: `INCR` + `EXPIRE` на счётчик `{namespace}:{key}` с TTL = окну
 * лимита. Первый INCR на ключе устанавливает значение 1, после чего ставим
 * EXPIRE — это атомично через pipeline. Окно «фиксированное» (sliding-window
 * не нужен для anti-abuse webhook'а).
 *
 * Используется в P4-T6 (`/api/webhooks/uniteller`, 100 req/min/IP) и в любых
 * future-API, где нужен IP/key-based limit (P4-T9 pull, P6 admin POST).
 */

import { getRedis } from "./redis";

export interface RateLimitInput {
  /** Полный ключ (включая префикс). Например `webhook:uniteller:1.2.3.4`. */
  key: string;
  /** Сколько запросов разрешено в окне. */
  limit: number;
  /** Длительность окна в секундах. */
  windowSec: number;
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * Регистрирует попытку и возвращает решение. На каждом вызове счётчик
 * инкрементится; при превышении — `ok: false` с `retryAfterSec`.
 *
 * Если Redis недоступен — fail-open (`ok: true, remaining: limit`): для
 * webhook'а лучше пропустить пару callback'ов, чем потерять платёж. Падать
 * с 500 на каждый callback из-за Redis-недоступности — хуже.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const { key, limit, windowSec } = input;
  if (limit <= 0) return { ok: false, retryAfterSec: windowSec };

  try {
    const redis = getRedis();
    // Pipeline: INCR + TTL атомично.
    const results = await redis.multi().incr(key).ttl(key).exec();
    if (!results || results.length !== 2) {
      return { ok: true, remaining: limit };
    }
    const count = results[0]?.[1] as number;
    const ttl = results[1]?.[1] as number;

    // Если ключ только что создан (TTL = -1, значит без expire) — выставляем.
    if (ttl === -1) {
      await redis.expire(key, windowSec);
    }

    if (count > limit) {
      const retryAfterSec = ttl > 0 ? ttl : windowSec;
      return { ok: false, retryAfterSec };
    }
    return { ok: true, remaining: Math.max(0, limit - count) };
  } catch {
    // Fail-open: см. JSDoc выше.
    return { ok: true, remaining: limit };
  }
}

/**
 * Извлекает client IP из стандартных Next.js / proxy-заголовков.
 * Порядок: `x-forwarded-for` (первый), `x-real-ip`, fallback на `unknown`.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
