/**
 * P7-T2 sub-task F: runtime-feature flags (СПЕЦИФИКАЦИЯ §6 правило 7).
 *
 * Тонкая обёртка над `features` table с 60s Redis-cache (паттерн от
 * P7-T1 sub-task B — `promo:v1:<CODE>`). Поддерживает hot-reload без
 * рестарта: admin меняет row через прямой SQL UPDATE (или будущий admin
 * UI в P8-T2), кэш протухает за 60s, новое значение подхватывается.
 *
 * **Fail-safe**: любая ошибка Redis/Prisma → возвращаем `fallback`. Это
 * критично для loyalty-percent на hot-path (capture-payment'е) — лучше
 * начислить по дефолтному 1%, чем заваливать webhook.
 *
 * **API**: только `getNumberFeature(key, fallback)` пока что. Дальше можно
 * добавить `getBooleanFeature` / `getStringFeature` (TODO: P7-T3 follow-up
 * или P8-T2).
 */

import { prisma } from "@bigmax/db";

import { getRedis } from "@/server/redis";

const FEATURE_CACHE_TTL_SECONDS = 60;
/** Версионированный prefix (как `promo:v1:`). Бамп → cache invalidation. */
export const FEATURE_CACHE_KEY_VERSION = "v1";
const FEATURE_CACHE_PREFIX = `feature:${FEATURE_CACHE_KEY_VERSION}:`;
/** Glob под `SCAN`-flush в e2e (`apps/web/e2e/helpers/redis.ts`). */
export const FEATURE_CACHE_GLOB = "feature:*";

function cacheKey(key: string): string {
  return `${FEATURE_CACHE_PREFIX}${key}`;
}

type ExpectedFeatureType = "number" | "boolean" | "string";

/**
 * Внутренний read-through cache, общий для всех типизированных getters.
 *  1. Redis hit → возвращаем raw string ("" если negative-cache marker).
 *  2. Miss → Prisma findUnique → проверяем `type === expected`, иначе
 *     null (с записью negative-cache marker, чтобы не долбить БД на
 *     каждом lookup'е mistyped ключа; протухнет за 60s).
 *  3. Ошибка Redis → fall through к Prisma.
 *  4. Ошибка Prisma → возвращаем null без cache-write (Redis flake'нул и
 *     тут ещё DB упала — не накачиваем кэш левыми значениями).
 *
 * Возвращает `null` если row не найдена / тип не совпал / любая ошибка БД.
 * Caller-getter применяет свою type-specific логику к raw value.
 */
async function readFeatureValue(
  key: string,
  expected: ExpectedFeatureType,
): Promise<string | null> {
  const ck = cacheKey(key);

  // 1. Cache read.
  try {
    const redis = getRedis();
    const cached = await redis.get(ck);
    if (cached !== null) {
      return cached === "" ? null : cached;
    }
  } catch {
    // Redis down → fall through to Prisma.
  }

  // 2. DB read.
  let value: string | null = null;
  try {
    const row = await prisma.feature.findUnique({
      where: { key },
      select: { value: true, type: true },
    });
    if (row && row.type === expected) {
      value = row.value;
    }
  } catch {
    return null;
  }

  // 3. Cache-write (включая negative marker для mistyped или missing rows).
  try {
    const redis = getRedis();
    await redis.set(ck, value ?? "", "EX", FEATURE_CACHE_TTL_SECONDS);
  } catch {
    // best-effort write.
  }

  return value;
}

/**
 * Number-typed feature reader. Возвращает `fallback` если row не найдена,
 * type ≠ "number", или value не парсится как finite число.
 */
export async function getNumberFeature(key: string, fallback: number): Promise<number> {
  const value = await readFeatureValue(key, "number");
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Boolean-typed feature reader. Парсит ровно `"true"` / `"false"`
 * (case-sensitive — admin form upper-cases). Любое другое значение →
 * fallback. Это защищает от случайного `1` / `yes` / `on` в значении.
 */
export async function getBooleanFeature(key: string, fallback: boolean): Promise<boolean> {
  const value = await readFeatureValue(key, "boolean");
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * String-typed feature reader. Возвращает raw value или `fallback`.
 * Пустая строка в БД считается «нет значения» и возвращает `fallback` —
 * это known trade-off: один marker (`""`) для всех negative-cases (row
 * отсутствует, type mismatch, пустое значение).
 *
 * P7-T2 sub-task O: для `brand.maintenance_message` это совпадает с
 * желаемым поведением: пустая строка = banner выключен = `getStringFeature`
 * возвращает empty fallback. Admin clearing banner через UI = `value=""`
 * в DB = `getMaintenanceMessage()` возвращает "" = banner скрыт.
 */
export async function getStringFeature(key: string, fallback: string): Promise<string> {
  const value = await readFeatureValue(key, "string");
  return value || fallback;
}

/**
 * Bust cache (зовётся из admin UI при изменении row). Сейчас admin UI
 * нет — admin меняет напрямую через SQL и ждёт 60s TTL. Helper всё равно
 * экспортирован, чтобы будущая admin-форма могла bust'ить.
 */
export async function invalidateFeatureCache(key: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(cacheKey(key));
  } catch {
    // best-effort.
  }
}
