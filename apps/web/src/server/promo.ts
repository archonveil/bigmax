/**
 * Серверная валидация промокодов (F17). Используется в `POST /api/checkout/pay`
 * и в `/api/cart/promo` (cart page — уже существует на клиенте, здесь же —
 * повторная проверка перед созданием Order, чтобы никто не отправил валидную
 * корзину с истёкшим/деактивированным промо).
 *
 * Не делает side-effects на Promo (usage_count инкрементится атомарно в
 * Uniteller webhook на первой капчуре + при COD `delivered`-transition).
 *
 * **P7-T1 sub-task B (OPT-010)**: lookup идёт через Redis-кэш с 60s TTL
 * (`promo:<UPPER>`). Cache-aside: на miss → Prisma → write-back; на admin
 * mutation вызывается `invalidatePromoCacheByCode`. Стандартизировали
 * lookup на `findUnique({ code: UPPER })` — UI всегда UPPER'ит вход, admin
 * форма тоже UPPER'ит при сохранении (Zod transform). Кэш fail-safe:
 * любое исключение из Redis ловится — fallback к Prisma, чтобы недоступный
 * Redis не валил критичный checkout-flow.
 */

import { prisma } from "@bigmax/db";

import { isPromoApplicable, type AppliedPromo, type PromoType } from "@/cart/promo";
import { getRedis } from "@/server/redis";

const PROMO_CACHE_TTL_SECONDS = 60;
/**
 * Версия cache-key'ев. Бампайте при изменении shape'а `PromoSnapshot`
 * (новые поля в `select`-фильтре, иначе deserialize вернёт stale-row
 * без новых полей). Старые ключи протухнут естественно за 60s TTL.
 *
 * История: v1 — initial shape (P7-T1).
 */
export const PROMO_CACHE_KEY_VERSION = "v1";
const PROMO_CACHE_PREFIX = `promo:${PROMO_CACHE_KEY_VERSION}:`;
/** Glob под `SCAN`-flush (e2e helpers). Покрывает все версии — на случай
 *  одновременного присутствия v1 и v2 ключей при переходе. */
export const PROMO_CACHE_GLOB = "promo:*";

/**
 * Поля Promo, нужные для validate. Зеркалит `select` ниже —
 * cache-snapshot хранится как JSON в Redis.
 */
export interface PromoSnapshot {
  code: string;
  type: PromoType;
  value: number;
  /** Тийны. `$extends.result` коэрсит BigInt → number на чтении. */
  minOrderCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

interface PromoSnapshotWire {
  code: string;
  type: PromoType;
  value: number;
  minOrderCents: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

function cacheKey(code: string): string {
  // Caller передаёт уже нормализованный код в `getCachedPromoByCode`,
  // но `invalidatePromoCacheByCode` принимает сырой — на всякий случай
  // делаем trim/UPPER здесь же (идемпотентно, дешёво).
  return `${PROMO_CACHE_PREFIX}${code.trim().toUpperCase()}`;
}

function toWire(s: PromoSnapshot): PromoSnapshotWire {
  return {
    ...s,
    startsAt: s.startsAt ? s.startsAt.toISOString() : null,
    endsAt: s.endsAt ? s.endsAt.toISOString() : null,
  };
}

function fromWire(w: PromoSnapshotWire): PromoSnapshot {
  return {
    ...w,
    startsAt: w.startsAt ? new Date(w.startsAt) : null,
    endsAt: w.endsAt ? new Date(w.endsAt) : null,
  };
}

/**
 * Cache-aside lookup. На miss идёт в Prisma и записывает результат с TTL.
 * Возвращает `null` если в БД нет такого `code` — но **не кэширует null**:
 * negative caching создаёт окно после `DELETE → POST` где ключ всё ещё
 * указывает на «нет» вместо нового промо. Защита от storm'а на пустых
 * кодах решается rate-limit'ом на route-уровне (P4-T6 / промо validate).
 */
export async function getCachedPromoByCode(code: string): Promise<PromoSnapshot | null> {
  const trimmed = code.trim().toUpperCase();
  if (trimmed === "") return null;
  const key = cacheKey(trimmed);

  try {
    const redis = getRedis();
    const cached = await redis.get(key);
    if (cached) {
      return fromWire(JSON.parse(cached) as PromoSnapshotWire);
    }
  } catch {
    // Redis недоступен — fail-safe: продолжаем в Prisma.
  }

  const row = await prisma.promo.findUnique({
    where: { code: trimmed },
    select: {
      code: true,
      type: true,
      value: true,
      minOrderCents: true,
      startsAt: true,
      endsAt: true,
      usageLimit: true,
      usedCount: true,
      isActive: true,
    },
  });
  if (!row) return null;
  const snapshot: PromoSnapshot = {
    code: row.code,
    type: row.type as PromoType,
    value: row.value,
    minOrderCents: row.minOrderCents,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    isActive: row.isActive,
  };

  try {
    const redis = getRedis();
    await redis.set(key, JSON.stringify(toWire(snapshot)), "EX", PROMO_CACHE_TTL_SECONDS);
  } catch {
    // Write-through fail тоже fail-safe: следующий запрос пройдёт через DB.
  }

  return snapshot;
}

/**
 * Bust cache для одного кода. Зовётся из admin POST/PATCH/DELETE.
 * На PATCH с изменением `code` зовите дважды: для старого и нового.
 */
export async function invalidatePromoCacheByCode(code: string): Promise<void> {
  const key = cacheKey(code);
  try {
    const redis = getRedis();
    await redis.del(key);
  } catch {
    // Redis недоступен — TTL естественно протухнет через 60s.
  }
}

export type PromoValidationResult =
  | { ok: true; promo: AppliedPromo }
  | {
      ok: false;
      reason: "not_found" | "inactive" | "expired" | "not_started" | "usage_limit" | "min_order";
    };

/**
 * Проверяет промо в БД + применимость к текущей корзине.
 * Cache-aware (см. `getCachedPromoByCode`).
 */
export async function validatePromoCode(
  code: string,
  subtotalCents: number,
): Promise<PromoValidationResult> {
  const trimmed = code.trim();
  if (trimmed === "") return { ok: false, reason: "not_found" };

  const row = await getCachedPromoByCode(trimmed);

  if (!row) return { ok: false, reason: "not_found" };
  if (!row.isActive) return { ok: false, reason: "inactive" };

  const now = new Date();
  if (row.startsAt && now < row.startsAt) return { ok: false, reason: "not_started" };
  if (row.endsAt && now > row.endsAt) return { ok: false, reason: "expired" };
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) {
    return { ok: false, reason: "usage_limit" };
  }

  const applied: AppliedPromo = {
    code: row.code,
    type: row.type,
    value: row.value,
    minOrderCents: row.minOrderCents,
  };

  const applicability = isPromoApplicable(applied, subtotalCents);
  if (!applicability.ok) return { ok: false, reason: "min_order" };

  return { ok: true, promo: applied };
}
