import { describe, expect, it } from "vitest";

import {
  computeDeliveryDiscountCents,
  computeDiscountCents,
  isPromoApplicable,
  type AppliedPromo,
} from "./promo";

const WELCOME10: AppliedPromo = {
  code: "WELCOME10",
  type: "percent",
  value: 10,
  minOrderCents: 10_000_000,
};

const FIXED50: AppliedPromo = {
  code: "FIXED50",
  type: "fixed",
  value: 5_000_000, // 50 000 сум
  minOrderCents: 10_000_000,
};

const FREEDELIVERY: AppliedPromo = {
  code: "FREESHIP",
  type: "free_delivery",
  value: 0,
  minOrderCents: 0,
};

describe("isPromoApplicable (minOrder)", () => {
  it("true когда subtotal ≥ minOrder", () => {
    expect(isPromoApplicable(WELCOME10, 10_000_000)).toEqual({ ok: true });
    expect(isPromoApplicable(WELCOME10, 20_000_000)).toEqual({ ok: true });
  });

  it("false с reason=minOrder когда subtotal < minOrder", () => {
    expect(isPromoApplicable(WELCOME10, 5_000_000)).toEqual({ ok: false, reason: "minOrder" });
  });

  it("promo без minOrder всегда применим (но subtotal>0)", () => {
    expect(isPromoApplicable(FREEDELIVERY, 0)).toEqual({ ok: true });
  });
});

describe("computeDiscountCents", () => {
  describe("percent", () => {
    it("10% от 150 000 сум = 15 000 сум", () => {
      expect(computeDiscountCents(WELCOME10, 15_000_000)).toBe(1_500_000);
    });

    it("floor при нечётном делении (0.5 тийн → 0)", () => {
      expect(computeDiscountCents({ ...WELCOME10, value: 33 }, 100)).toBe(33);
      // 100 * 33 / 100 = 33, точно.
      expect(computeDiscountCents({ ...WELCOME10, value: 33 }, 101)).toBe(33);
      // floor(101 * 33 / 100) = floor(33.33) = 33.
    });

    it("clamp value в [0..100]", () => {
      expect(computeDiscountCents({ ...WELCOME10, value: 150 }, 1000)).toBe(1000);
      expect(computeDiscountCents({ ...WELCOME10, value: -10 }, 1000)).toBe(0);
    });

    it("100% → subtotal покрывает весь заказ", () => {
      expect(computeDiscountCents({ ...WELCOME10, value: 100 }, 1_000_000)).toBe(1_000_000);
    });
  });

  describe("fixed", () => {
    it("возвращает value при subtotal ≥ value", () => {
      expect(computeDiscountCents(FIXED50, 10_000_000)).toBe(5_000_000);
    });

    it("clamp до subtotal когда value > subtotal", () => {
      expect(computeDiscountCents(FIXED50, 3_000_000)).toBe(3_000_000);
    });

    it("negative value → 0", () => {
      expect(computeDiscountCents({ ...FIXED50, value: -100 }, 10_000)).toBe(0);
    });
  });

  describe("free_delivery", () => {
    it("не даёт скидки на subtotal", () => {
      expect(computeDiscountCents(FREEDELIVERY, 15_000_000)).toBe(0);
    });
  });

  it("subtotal ≤ 0 → 0", () => {
    expect(computeDiscountCents(WELCOME10, 0)).toBe(0);
    expect(computeDiscountCents(WELCOME10, -1)).toBe(0);
  });
});

describe("computeDeliveryDiscountCents", () => {
  it("free_delivery → покрывает всю доставку", () => {
    expect(computeDeliveryDiscountCents(FREEDELIVERY, 3_000_000)).toBe(3_000_000);
  });

  it("percent / fixed → 0", () => {
    expect(computeDeliveryDiscountCents(WELCOME10, 3_000_000)).toBe(0);
    expect(computeDeliveryDiscountCents(FIXED50, 3_000_000)).toBe(0);
  });

  it("negative delivery → 0 (safety)", () => {
    expect(computeDeliveryDiscountCents(FREEDELIVERY, -100)).toBe(0);
  });
});
