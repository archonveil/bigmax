/**
 * Калькулятор стоимости доставки по Узбекистану. Чистая функция — используется
 * и в UI (реактивный предпросмотр в OrderSummary/StepDelivery/StepReview), и на
 * сервере при создании Order (P4-T5) → single source of truth.
 *
 * Зоны:
 *   1. Ташкент-центр (5 районов)                 — 15 000 сум, 1–2 дн.
 *   2. Ташкент-окраина (6 районов)               — 25 000 сум, 1–2 дн.
 *   3. Ташкентская область                       — 35 000 сум, 2–3 дн.
 *   4. Ближние регионы (8 областей, долина+юг)   — 50 000 сум, 2–4 дн.
 *   5. Дальние регионы (Хорезм, Каракалпакстан)  — 80 000 сум, 3–6 дн.
 *   pickup                                       — 0, расчёт не нужен.
 *
 * Free-shipping threshold: 500 000 сум subtotal → 0.
 *
 * Тарифы хардкожены по решению: справочник меняется редко, админ-панели нет
 * до P6, отдельная Prisma-модель/миграция = overkill для MVP. Тонкая настройка
 * бизнесом — см. README раздел «Delivery zones».
 */

import { TASHKENT_CITY_SLUG, TASHKENT_DISTRICTS } from "./regions";

/** 1 сум = 100 тийинов (cents). */
const SUM = 100;

/** Пороговая сумма корзины, выше которой доставка бесплатна. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 500_000 * SUM;

/** 5 центральных районов Ташкента — близко к складу, базовый тариф. */
export const TASHKENT_CENTRAL_DISTRICTS = [
  "mirobod",
  "mirzo-ulugbek",
  "shayxontohur",
  "yakkasaroy",
  "yunusobod",
] as const satisfies readonly string[];

/** 6 окраинных районов Ташкента. */
export const TASHKENT_OUTER_DISTRICTS = [
  "bektemir",
  "chilonzor",
  "olmazor",
  "sergeli",
  "uchtepa",
  "yashnobod",
] as const satisfies readonly string[];

/** Ближние регионы — Ферганская долина + Самаркандско-Бухарский кластер + юг. */
export const NEARBY_REGIONS = [
  "andijan",
  "bukhara",
  "fergana",
  "jizzakh",
  "namangan",
  "navoiy",
  "qashqadaryo",
  "samarkand",
  "sirdaryo",
  "surxondaryo",
] as const satisfies readonly string[];

/** Дальние регионы — Хорезм и Каракалпакстан. */
export const FAR_REGIONS = ["karakalpakstan", "khorezm"] as const satisfies readonly string[];

export type DeliveryZone =
  | "tashkent-central"
  | "tashkent-outer"
  | "tashkent-region"
  | "nearby-region"
  | "far-region";

interface ZoneRate {
  cents: number;
  minDays: number;
  maxDays: number;
}

const ZONE_RATES: Record<DeliveryZone, ZoneRate> = {
  "tashkent-central": { cents: 15_000 * SUM, minDays: 1, maxDays: 2 },
  "tashkent-outer": { cents: 25_000 * SUM, minDays: 1, maxDays: 2 },
  "tashkent-region": { cents: 35_000 * SUM, minDays: 2, maxDays: 3 },
  "nearby-region": { cents: 50_000 * SUM, minDays: 2, maxDays: 4 },
  "far-region": { cents: 80_000 * SUM, minDays: 3, maxDays: 6 },
};

// ---------------------------------------------------------------------------
// Calculator API
// ---------------------------------------------------------------------------

export interface DeliveryEstimateInput {
  method: "courier" | "pickup";
  /** Slug региона (UZ_REGIONS) или "" если не выбран. */
  region: string;
  /** Slug района Ташкента (TASHKENT_DISTRICTS) или "" если не выбран. */
  district: string;
  /** Сумма корзины в tiyin для free-shipping threshold. */
  subtotalCents: number;
}

export type DeliveryEstimate =
  | {
      kind: "priced";
      zone: DeliveryZone | "pickup";
      /** Сколько списать с клиента. 0 → бесплатно (threshold/pickup). */
      cents: number;
      /** true если cents=0 (pickup или free-shipping). */
      isFree: boolean;
      /** Полная цена зоны до применения threshold — нужно для сравнения и БД. */
      baseCents: number;
      minDays: number;
      maxDays: number;
    }
  | { kind: "needs-info"; reason: "missing-region" | "missing-district" | "unknown-region" };

/**
 * Возвращает оценку стоимости и сроков доставки.
 * Для pickup — всегда `{cents: 0, minDays: 0, maxDays: 0}`.
 * Для courier — зона определяется по `region` + (для Ташкента) `district`.
 * Если данных недостаточно → `needs-info`.
 */
export function estimateDelivery(input: DeliveryEstimateInput): DeliveryEstimate {
  if (input.method === "pickup") {
    return {
      kind: "priced",
      zone: "pickup",
      cents: 0,
      isFree: true,
      baseCents: 0,
      minDays: 0,
      maxDays: 0,
    };
  }

  const zone = resolveZone(input.region, input.district);
  if (zone.kind === "needs-info") return zone;

  const rate = ZONE_RATES[zone.zone];
  const isFree = input.subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;

  return {
    kind: "priced",
    zone: zone.zone,
    cents: isFree ? 0 : rate.cents,
    isFree,
    baseCents: rate.cents,
    minDays: rate.minDays,
    maxDays: rate.maxDays,
  };
}

type ZoneResolution =
  | { kind: "zone"; zone: DeliveryZone }
  | { kind: "needs-info"; reason: "missing-region" | "missing-district" | "unknown-region" };

function resolveZone(region: string, district: string): ZoneResolution {
  if (region === "") return { kind: "needs-info", reason: "missing-region" };

  if (region === TASHKENT_CITY_SLUG) {
    if (district === "") return { kind: "needs-info", reason: "missing-district" };
    if ((TASHKENT_CENTRAL_DISTRICTS as readonly string[]).includes(district)) {
      return { kind: "zone", zone: "tashkent-central" };
    }
    if ((TASHKENT_OUTER_DISTRICTS as readonly string[]).includes(district)) {
      return { kind: "zone", zone: "tashkent-outer" };
    }
    // Неизвестный district при известном Ташкенте — консервативно окраина.
    return { kind: "zone", zone: "tashkent-outer" };
  }

  if (region === "tashkent-region") return { kind: "zone", zone: "tashkent-region" };
  if ((NEARBY_REGIONS as readonly string[]).includes(region)) {
    return { kind: "zone", zone: "nearby-region" };
  }
  if ((FAR_REGIONS as readonly string[]).includes(region)) {
    return { kind: "zone", zone: "far-region" };
  }

  return { kind: "needs-info", reason: "unknown-region" };
}

/**
 * Sanity-check: в `TASHKENT_CENTRAL_DISTRICTS + TASHKENT_OUTER_DISTRICTS` должно
 * быть все 11 районов из `TASHKENT_DISTRICTS`. Экспортируется для тестов, но
 * полезен и в runtime-ассертах при сиде/миграции.
 */
export function tashkentDistrictsCoverageOk(): boolean {
  const covered = new Set<string>([...TASHKENT_CENTRAL_DISTRICTS, ...TASHKENT_OUTER_DISTRICTS]);
  return (
    TASHKENT_DISTRICTS.every((d) => covered.has(d.slug)) &&
    covered.size === TASHKENT_DISTRICTS.length
  );
}
