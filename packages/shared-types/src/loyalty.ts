/**
 * P7-T2 «Бигмах Бонус» — публичные константы (client- и server-safe).
 *
 * Раньше эти числа жили в `apps/web/src/server/loyalty.ts`, но client-side
 * UI (`<LoyaltyBlock>` в StepReview) тоже должен знать порог `MIN_ORDER` —
 * чтобы показать inline-hint «минимум 5_000 сум» и НЕ дать ввести баллы
 * на под-минимум-заказе. Импорт из `@/server/...` в client-bundle тянул бы
 * Prisma-зависимости, поэтому константы вынесены сюда.
 *
 * Точное значение процента earn — динамическое (env / DB feature row) и
 * остаётся в `apps/web/src/server/loyalty.ts`.
 */

/** Стоимость одного балла в тийнах. v1: 100 тийн = 1 сум. */
export const LOYALTY_POINT_VALUE_CENTS = 100;

/** Hard-cap на запрашиваемое количество баллов (anti-DoS). */
export const LOYALTY_POINTS_MAX = 10_000_000;

/**
 * Минимальная сумма заказа (тийны), при которой разрешено списание баллов.
 * v1: 5_000 сум = 500_000 тийн.
 */
export const LOYALTY_MIN_ORDER_TO_SPEND_CENTS = 500_000;
