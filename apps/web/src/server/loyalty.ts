/**
 * P7-T2: «Бигмах Бонус» — программа лояльности.
 *
 * **Правила (СПЕЦИФИКАЦИЯ §8 / F16):**
 *  - 1% от суммы заказа → начисляются баллы.
 *  - 1 балл = 1 сум (= 100 тийн).
 *  - Начисление: после `Payment.status=captured` (Uniteller webhook на первой
 *    капчуре + COD-`delivered` admin-transition).
 *  - Списание: при оплате (user указывает `pointsToSpend` в checkout/pay).
 *
 * **Конвертация:**
 *   earned_points = floor(total_cents * percent / 100 / POINT_VALUE_CENTS)
 *                 = floor(total_cents / 10_000)            // при percent=1
 *   discount_cents = points * POINT_VALUE_CENTS = points * 100
 *
 * **Anti-tamper:**
 *  - Earned считается на сервере по `Order.totalCents`, не из user-input.
 *  - Spent: `pointsToSpend` приходит из клиента, но clamp'ится на сервере:
 *    `min(user.loyaltyPoints, floor((totalCents - 1) / 100))` — последний
 *    тийн оставляем, чтобы Uniteller не отвергал 0-amount.
 *
 * **Atomicity:**
 *  - `awardLoyaltyPoints(tx, …)` — внутри одного `$transaction` с Payment update
 *    + Order update (см. uniteller webhook / admin orders status route).
 *  - `spendLoyaltyPoints(tx, …)` — внутри одного `$transaction` с Order create
 *    (см. checkout/pay route).
 *  - Оба используют `User.update({ data: { loyaltyPoints: { increment } } })`
 *    — атомарный inc/dec, без race между read-modify-write.
 */

import { type ExtendedPrismaClient, type TransactionClient, LoyaltyType } from "@bigmax/db";
import {
  LOYALTY_POINT_VALUE_CENTS as SHARED_POINT_VALUE_CENTS,
  LOYALTY_POINTS_MAX as SHARED_POINTS_MAX,
  LOYALTY_MIN_ORDER_TO_SPEND_CENTS as SHARED_MIN_ORDER_TO_SPEND_CENTS,
} from "@bigmax/shared-types";

import { getBooleanFeature, getNumberFeature } from "@/server/features";

/**
 * P7-T2 sub-task F: ключ для override через `features` table. Admin
 * может изменить процент кэшбэка без рестарта через прямой SQL UPDATE.
 * Кэш протухает за 60s, новое значение подхватывается.
 */
export const LOYALTY_EARN_PERCENT_FEATURE_KEY = "loyalty.earn_percent";

/**
 * P7-T2 sub-task L: kill-switch на списание баллов в checkout. `false` →
 * `pointsToSpend` игнорируется (но earn-flow продолжает работать). Полезно
 * для emergency-disable (fraud incident, баг в clamp-логике).
 */
export const LOYALTY_SPEND_ENABLED_FEATURE_KEY = "loyalty.spend_enabled";

/**
 * Получить текущий процент earn'а. Источник правды:
 *   1. `features.WHERE(key='loyalty.earn_percent', type='number')` — DB override.
 *   2. env `LOYALTY_EARN_PERCENT` (читался при module-load).
 *   3. Hard-coded `1` если ни DB, ни env.
 *
 * Hot-reload: DB row меняется → cache TTL 60s → новое значение.
 * Sanity-cap (`[0.01..50]`) применяется при парсинге env; DB-row caller
 * должен сам проверить (но в условиях seed-row значение всегда валидно).
 */
export async function getLoyaltyEarnPercent(): Promise<number> {
  return getNumberFeature(LOYALTY_EARN_PERCENT_FEATURE_KEY, LOYALTY_EARN_PERCENT);
}

/**
 * P7-T2 sub-task L: global kill-switch для loyalty spend'а в checkout.
 * Default `true` — если row отсутствует или Redis/Prisma упали, продолжаем
 * списывать (fail-open для UX, fail-closed-flow есть в server `clampPointsToSpend`).
 */
export async function isLoyaltySpendEnabled(): Promise<boolean> {
  return getBooleanFeature(LOYALTY_SPEND_ENABLED_FEATURE_KEY, true);
}

// ---------------------------------------------------------------------------
// Constants & env
// ---------------------------------------------------------------------------

/**
 * P7-T2 sub-task C: процент начисления читается из env `LOYALTY_EARN_PERCENT`
 * (для маркетинговых акций с увеличенным кэшбэком — «5% на выходных»).
 * Fallback = 1% при отсутствии/невалидном значении. Sanity-cap = [0.01..50],
 * чтобы случайно не выставить «1000%» через опечатку.
 */
function readEarnPercent(): number {
  const raw = process.env["LOYALTY_EARN_PERCENT"];
  if (!raw) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 50) return 1;
  return parsed;
}

/**
 * Pure-функция (для тестов и спец-вызовов). В runtime используется
 * `LOYALTY_EARN_PERCENT` ниже — он зачитывается один раз при загрузке модуля.
 */
export function parseEarnPercent(envValue: string | undefined): number {
  const raw = envValue;
  if (!raw) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 50) return 1;
  return parsed;
}

/** Процент начисления от `Order.totalCents`. v1: env `LOYALTY_EARN_PERCENT`. */
export const LOYALTY_EARN_PERCENT = readEarnPercent();

// Re-export client-safe констант из `@bigmax/shared-types` — UI импортирует
// их оттуда напрямую, server-callers продолжают тащить через этот модуль.
export const LOYALTY_POINT_VALUE_CENTS = SHARED_POINT_VALUE_CENTS;
export const LOYALTY_POINTS_MAX = SHARED_POINTS_MAX;
export const LOYALTY_MIN_ORDER_TO_SPEND_CENTS = SHARED_MIN_ORDER_TO_SPEND_CENTS;

// ---------------------------------------------------------------------------
// Pure helpers (testable без БД)
// ---------------------------------------------------------------------------

/**
 * Сколько баллов начислится за `totalCents`-заказ. Округляем floor — никаких
 * дробных баллов. Заказ < 10_000 тийн (= 100 сум) даст 0 баллов — это норма.
 */
export function computeEarnedPoints(
  totalCents: number,
  percent: number = LOYALTY_EARN_PERCENT,
): number {
  if (totalCents <= 0 || percent <= 0) return 0;
  const cents = Math.floor((totalCents * percent) / 100);
  return Math.floor(cents / LOYALTY_POINT_VALUE_CENTS);
}

/** Цена `points` баллов в тийнах. Pure. */
export function computeLoyaltyDiscountCents(points: number): number {
  if (points <= 0) return 0;
  return points * LOYALTY_POINT_VALUE_CENTS;
}

/**
 * Pure clamp: сколько баллов МОЖНО потратить на этот заказ.
 *  - `requested` ≤ 0 → 0.
 *  - `requested` > `balance` → `balance`.
 *  - `discount` не должен сделать total <= 0 (Uniteller rejects 0-amount).
 *    Поэтому max_spend_cents = totalCents - 1, max_points = floor(/POINT_VALUE).
 *  - **P7-T2 sub-task B**: `totalCents < LOYALTY_MIN_ORDER_TO_SPEND_CENTS` → 0.
 *    Защита от микро-заказов с 1-балльной скидкой.
 *
 * Возвращает 0 для негативного/мусорного input — caller не должен
 * предположить отрицательное значение.
 */
export function clampPointsToSpend(requested: number, balance: number, totalCents: number): number {
  if (!Number.isInteger(requested) || requested <= 0) return 0;
  if (!Number.isInteger(balance) || balance <= 0) return 0;
  if (!Number.isInteger(totalCents) || totalCents <= LOYALTY_POINT_VALUE_CENTS) return 0;
  if (totalCents < LOYALTY_MIN_ORDER_TO_SPEND_CENTS) return 0;
  const maxByTotal = Math.floor((totalCents - 1) / LOYALTY_POINT_VALUE_CENTS);
  return Math.min(requested, balance, maxByTotal, LOYALTY_POINTS_MAX);
}

// ---------------------------------------------------------------------------
// TX helpers
// ---------------------------------------------------------------------------

interface AwardInput {
  userId: string;
  orderId: string;
  totalCents: number;
  /**
   * P7-T2 sub-task F: процент earn'а можно передать явно (для тестов или
   * runtime-override через `getLoyaltyEarnPercent()`). Если не передан —
   * используется module-level `LOYALTY_EARN_PERCENT` (env / fallback).
   */
  percent?: number;
}

/**
 * Атомарно начисляет баллы на User + пишет LoyaltyTransaction(earn).
 * Idempotency гарантируется caller'ом — должен вызываться только на ПЕРВОМ
 * переходе `Payment.status → captured`. См. `isFirstCapture` в Uniteller
 * webhook + фильтр `provider:"cod" status:"pending"` в COD-капчуре.
 *
 * 0 баллов (totalCents < 10_000 тийн) — silent no-op. Не пишем пустой
 * LoyaltyTransaction, чтобы не засорять историю.
 */
export async function awardLoyaltyPoints(
  tx: ExtendedPrismaClient | TransactionClient,
  input: AwardInput,
): Promise<number> {
  const percent = input.percent ?? LOYALTY_EARN_PERCENT;
  const points = computeEarnedPoints(input.totalCents, percent);
  if (points <= 0) return 0;
  await tx.user.update({
    where: { id: input.userId },
    data: { loyaltyPoints: { increment: points } },
  });
  await tx.loyaltyTransaction.create({
    data: {
      userId: input.userId,
      orderId: input.orderId,
      points,
      type: LoyaltyType.earn,
    },
  });
  return points;
}

interface SpendInput {
  userId: string;
  orderId: string;
  /** Положительное количество баллов к списанию. */
  points: number;
}

/**
 * Атомарно списывает баллы с User + пишет LoyaltyTransaction(spend).
 * `points` (positive) — то, что пользователь решил потратить (уже clamp'ed
 * caller'ом через `clampPointsToSpend`). В LoyaltyTransaction записываем
 * `-points` чтобы при `SUM(points)` получить правильный баланс.
 *
 * Атомарность баланса гарантируется `{ decrement: points }` Prisma-op
 * (один SQL `UPDATE ... SET loyalty_points = loyalty_points - $1`).
 *
 * 0 — silent no-op.
 */
export async function spendLoyaltyPoints(
  tx: ExtendedPrismaClient | TransactionClient,
  input: SpendInput,
): Promise<void> {
  if (input.points <= 0) return;
  await tx.user.update({
    where: { id: input.userId },
    data: { loyaltyPoints: { decrement: input.points } },
  });
  await tx.loyaltyTransaction.create({
    data: {
      userId: input.userId,
      orderId: input.orderId,
      points: -input.points,
      type: LoyaltyType.spend,
    },
  });
}

// ---------------------------------------------------------------------------
// Reversal (P7-T2 sub-task A)
// ---------------------------------------------------------------------------

export interface LoyaltyReversalResult {
  /** Сколько баллов возвращено юзеру (positive). 0 если spend'а не было. */
  refunded: number;
  /** Сколько баллов изъято у юзера обратно (positive). 0 если earn'а не было. */
  clawedBack: number;
  /** Уже было обнулено ранее — no-op. */
  alreadyReversed: boolean;
}

/**
 * P7-T2 sub-task A: реверсирует все loyalty-операции по заказу.
 *
 * Семантика: при `Order.status → cancelled / refunded` нужно вернуть
 * пользователю списанные баллы (если spend был) И изъять начисленные
 * (если earn был, т.е. заказ прошёл через capture до отмены).
 *
 * Алгоритм:
 *  1. Читаем все `LoyaltyTransaction.WHERE(orderId=X)` для этого заказа.
 *  2. Net = SUM(points). Если 0 → already reversed (idempotent), no-op.
 *  3. Раздельно считаем spent (отрицательные spend-rows) и earned
 *     (положительные earn-rows), и проверяем нет ли уже refund/clawback-rows.
 *  4. Пишем counter-row(s) с типом `refund` (positive) или `clawback`
 *     (negative) — UI отличает регулярные операции от reversal'ов.
 *  5. Балланс User.loyaltyPoints обновляется одним атомарным `update` с
 *     net-delta = -net.
 *
 * Идемпотентность: повторный вызов на уже-balanced заказ → `alreadyReversed=true`,
 * никаких side effects. Это важно — admin может случайно переключить статус
 * cancelled → refunded или обратно.
 *
 * Принимает `tx` (callback-form `$transaction`).
 */
export async function reverseLoyaltyForOrder(
  tx: ExtendedPrismaClient | TransactionClient,
  orderId: string,
): Promise<LoyaltyReversalResult> {
  const rows = await tx.loyaltyTransaction.findMany({
    where: { orderId },
    select: { userId: true, points: true, type: true },
  });
  if (rows.length === 0) {
    return { refunded: 0, clawedBack: 0, alreadyReversed: false };
  }

  const net = rows.reduce((acc, r) => acc + r.points, 0);
  if (net === 0) {
    return { refunded: 0, clawedBack: 0, alreadyReversed: true };
  }

  // Все rows по одному order'у привязаны к одному user'у (Order.userId).
  // Берём первого — invariant.
  const userId = rows[0]!.userId;

  // Разделяем reversal на refund-часть (вернуть spend) и clawback-часть
  // (изъять earn) — пишем отдельные rows, чтобы UI и аналитика могли их
  // различать. Сумма всё равно зануляет net.
  const spentNegative = rows
    .filter((r) => r.type === LoyaltyType.spend)
    .reduce((a, r) => a + r.points, 0); // отрицательное число (или 0)
  const earnedPositive = rows
    .filter((r) => r.type === LoyaltyType.earn)
    .reduce((a, r) => a + r.points, 0); // положительное число (или 0)

  // Считаем что reversal ещё не было (мы выше уже проверили sum=0).
  const refundPoints = Math.max(0, -spentNegative); // вернуть N (positive).
  const clawbackPoints = Math.max(0, earnedPositive); // изъять M (positive).

  const writes: Array<Promise<unknown>> = [];

  if (refundPoints > 0) {
    writes.push(
      tx.loyaltyTransaction.create({
        data: {
          userId,
          orderId,
          points: refundPoints,
          type: LoyaltyType.refund,
        },
      }),
    );
  }
  if (clawbackPoints > 0) {
    writes.push(
      tx.loyaltyTransaction.create({
        data: {
          userId,
          orderId,
          points: -clawbackPoints,
          type: LoyaltyType.clawback,
        },
      }),
    );
  }
  // Net-delta на баланс User'а: refund добавляет, clawback вычитает.
  // Один атомарный update — `increment` с возможно-негативным значением
  // поддерживается Prisma. `-net` точно зануляет историю по этому order'у.
  writes.push(
    tx.user.update({
      where: { id: userId },
      data: { loyaltyPoints: { increment: -net } },
    }),
  );
  await Promise.all(writes);

  return {
    refunded: refundPoints,
    clawedBack: clawbackPoints,
    alreadyReversed: false,
  };
}
