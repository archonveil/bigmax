import { describe, expect, it } from "vitest";

import {
  estimateDelivery,
  FAR_REGIONS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  NEARBY_REGIONS,
  TASHKENT_CENTRAL_DISTRICTS,
  TASHKENT_OUTER_DISTRICTS,
  tashkentDistrictsCoverageOk,
} from "./delivery";

const SUM = 100;
const LOW_SUBTOTAL = 100_000 * SUM; // 100k сум — ниже threshold

describe("estimateDelivery · pickup", () => {
  it("pickup → 0 cents, 0 days, isFree=true независимо от региона", () => {
    const est = estimateDelivery({
      method: "pickup",
      region: "",
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    expect(est).toEqual({
      kind: "priced",
      zone: "pickup",
      cents: 0,
      isFree: true,
      baseCents: 0,
      minDays: 0,
      maxDays: 0,
    });
  });
});

describe("estimateDelivery · Ташкент-центр", () => {
  it.each(TASHKENT_CENTRAL_DISTRICTS)(
    "%s → 15 000 сум, 1–2 дня, zone=tashkent-central",
    (district) => {
      const est = estimateDelivery({
        method: "courier",
        region: "tashkent-city",
        district,
        subtotalCents: LOW_SUBTOTAL,
      });
      expect(est).toEqual({
        kind: "priced",
        zone: "tashkent-central",
        cents: 15_000 * SUM,
        isFree: false,
        baseCents: 15_000 * SUM,
        minDays: 1,
        maxDays: 2,
      });
    },
  );
});

describe("estimateDelivery · Ташкент-окраина", () => {
  it.each(TASHKENT_OUTER_DISTRICTS)("%s → 25 000 сум, 1–2 дня, zone=tashkent-outer", (district) => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-city",
      district,
      subtotalCents: LOW_SUBTOTAL,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.zone).toBe("tashkent-outer");
    expect(est.cents).toBe(25_000 * SUM);
    expect(est.minDays).toBe(1);
    expect(est.maxDays).toBe(2);
  });
});

describe("estimateDelivery · Ташкентская область", () => {
  it("tashkent-region → 35 000 сум, 2–3 дня", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-region",
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.zone).toBe("tashkent-region");
    expect(est.cents).toBe(35_000 * SUM);
    expect(est.minDays).toBe(2);
    expect(est.maxDays).toBe(3);
  });
});

describe("estimateDelivery · ближние регионы", () => {
  it.each(NEARBY_REGIONS)("%s → 50 000 сум, 2–4 дня, zone=nearby-region", (region) => {
    const est = estimateDelivery({
      method: "courier",
      region,
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.zone).toBe("nearby-region");
    expect(est.cents).toBe(50_000 * SUM);
    expect(est.minDays).toBe(2);
    expect(est.maxDays).toBe(4);
  });
});

describe("estimateDelivery · дальние регионы", () => {
  it.each(FAR_REGIONS)("%s → 80 000 сум, 3–6 дней, zone=far-region", (region) => {
    const est = estimateDelivery({
      method: "courier",
      region,
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.zone).toBe("far-region");
    expect(est.cents).toBe(80_000 * SUM);
    expect(est.minDays).toBe(3);
    expect(est.maxDays).toBe(6);
  });
});

describe("estimateDelivery · free-shipping threshold", () => {
  it("subtotal ≥ 500 000 сум → cents=0, isFree=true, baseCents сохраняется", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-city",
      district: "mirobod",
      subtotalCents: FREE_SHIPPING_THRESHOLD_CENTS,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.cents).toBe(0);
    expect(est.isFree).toBe(true);
    expect(est.baseCents).toBe(15_000 * SUM);
  });

  it("subtotal на tiyin ниже threshold → платная доставка", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-city",
      district: "mirobod",
      subtotalCents: FREE_SHIPPING_THRESHOLD_CENTS - 1,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.cents).toBe(15_000 * SUM);
    expect(est.isFree).toBe(false);
  });

  it("free-shipping применяется и к дальним регионам", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "karakalpakstan",
      district: "",
      subtotalCents: FREE_SHIPPING_THRESHOLD_CENTS * 2,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.cents).toBe(0);
    expect(est.isFree).toBe(true);
    expect(est.baseCents).toBe(80_000 * SUM);
  });
});

describe("estimateDelivery · needs-info", () => {
  it("пустой region → missing-region", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "",
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    expect(est).toEqual({ kind: "needs-info", reason: "missing-region" });
  });

  it("tashkent-city без district → missing-district", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-city",
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    expect(est).toEqual({ kind: "needs-info", reason: "missing-district" });
  });

  it("неизвестный region → unknown-region", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "mars-colony",
      district: "",
      subtotalCents: LOW_SUBTOTAL,
    });
    expect(est).toEqual({ kind: "needs-info", reason: "unknown-region" });
  });
});

describe("estimateDelivery · покрытие районов", () => {
  it("TASHKENT_CENTRAL + TASHKENT_OUTER покрывают все 11 TASHKENT_DISTRICTS", () => {
    expect(tashkentDistrictsCoverageOk()).toBe(true);
  });

  it("неизвестный district при known tashkent-city → fallback на outer (консервативно)", () => {
    const est = estimateDelivery({
      method: "courier",
      region: "tashkent-city",
      district: "unknown-district",
      subtotalCents: LOW_SUBTOTAL,
    });
    if (est.kind !== "priced") throw new Error("expected priced");
    expect(est.zone).toBe("tashkent-outer");
    expect(est.cents).toBe(25_000 * SUM);
  });
});
