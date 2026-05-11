/**
 * Pure helpers для промокодов (F17). Без Prisma/React — используются и
 * сервером (validate API), и клиентом (cart page), и тестами.
 */

export const PROMO_TYPES = ["percent", "fixed", "free_delivery"] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

/** Snapshot валидированного сервером промокода. Персистится в cart-store. */
export interface AppliedPromo {
  code: string;
  type: PromoType;
  /** percent: 0..100; fixed/free_delivery: тийны. */
  value: number;
  minOrderCents: number;
}

export type PromoApplicabilityReason = "minOrder";

/** Проверка применимости на клиенте (minOrder) — после manual remove позиции. */
export function isPromoApplicable(
  promo: AppliedPromo,
  subtotalCents: number,
): { ok: true } | { ok: false; reason: PromoApplicabilityReason } {
  if (subtotalCents < promo.minOrderCents) return { ok: false, reason: "minOrder" };
  return { ok: true };
}

/**
 * Сумма скидки в тийнах, которую даёт промо на subtotal (без доставки).
 * free_delivery на subtotal не влияет — там нулевая скидка по позициям.
 * Никогда не превышает subtotal — floor при делении, чтобы не получить
 * дробные тийны.
 */
export function computeDiscountCents(promo: AppliedPromo, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  switch (promo.type) {
    case "percent": {
      const pct = Math.max(0, Math.min(100, promo.value));
      return Math.min(subtotalCents, Math.floor((subtotalCents * pct) / 100));
    }
    case "fixed":
      return Math.min(subtotalCents, Math.max(0, promo.value));
    case "free_delivery":
      // Скидка на доставку обрабатывается отдельно (computeDeliveryDiscount).
      return 0;
  }
}

/**
 * Сумма скидки на доставку в тийнах. Для `free_delivery` = вся стоимость
 * доставки. Для прочих = 0.
 */
export function computeDeliveryDiscountCents(promo: AppliedPromo, deliveryCents: number): number {
  if (promo.type === "free_delivery") return Math.max(0, deliveryCents);
  return 0;
}
