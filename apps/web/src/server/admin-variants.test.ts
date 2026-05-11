/**
 * P6-T3 follow-up: Zod-схемы variant CRUD. БД-операции — e2e.
 */

import { describe, expect, it } from "vitest";

import { VariantCreateSchema, VariantUpdateSchema } from "./admin-variants";

const VALID = {
  sku: "NB-PAC-PK-A1",
  color: "pink",
  size: "0-6m",
  priceCents: 50_000_00,
  oldPriceCents: 60_000_00,
  barcode: "1234567890123",
  weightGrams: 50,
};

describe("VariantCreateSchema", () => {
  it("happy: все поля → ok", () => {
    expect(VariantCreateSchema.safeParse(VALID).success).toBe(true);
  });

  it("минимум: sku + price → ok", () => {
    expect(VariantCreateSchema.safeParse({ sku: "MIN-001", priceCents: 100 }).success).toBe(true);
  });

  it("sku в нижнем регистре → sku_invalid", () => {
    const r = VariantCreateSchema.safeParse({ ...VALID, sku: "nb-pac-pk" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("sku_invalid");
  });

  it("sku с пробелом → sku_invalid", () => {
    expect(VariantCreateSchema.safeParse({ ...VALID, sku: "NB PAC PK" }).success).toBe(false);
  });

  it("sku 1 символ → sku_too_short", () => {
    const r = VariantCreateSchema.safeParse({ ...VALID, sku: "X" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("sku_too_short");
  });

  it("priceCents < 0 → price_negative", () => {
    const r = VariantCreateSchema.safeParse({ ...VALID, priceCents: -100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("price_negative");
  });

  it("priceCents float → price_must_be_integer", () => {
    const r = VariantCreateSchema.safeParse({ ...VALID, priceCents: 100.5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("price_must_be_integer");
  });

  it("oldPriceCents > priceCents → ok", () => {
    expect(
      VariantCreateSchema.safeParse({ ...VALID, priceCents: 100, oldPriceCents: 200 }).success,
    ).toBe(true);
  });

  it("oldPriceCents == priceCents → old_price_must_exceed_price", () => {
    const r = VariantCreateSchema.safeParse({
      ...VALID,
      priceCents: 100,
      oldPriceCents: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("old_price_must_exceed_price");
  });

  it("oldPriceCents < priceCents → fail (negative discount)", () => {
    expect(
      VariantCreateSchema.safeParse({ ...VALID, priceCents: 200, oldPriceCents: 100 }).success,
    ).toBe(false);
  });

  it("oldPriceCents=null → ok (no discount)", () => {
    expect(VariantCreateSchema.safeParse({ ...VALID, oldPriceCents: null }).success).toBe(true);
  });

  it("color/size = null → ok", () => {
    expect(VariantCreateSchema.safeParse({ ...VALID, color: null, size: null }).success).toBe(true);
  });

  it("weightGrams отрицательный → weight_negative", () => {
    expect(VariantCreateSchema.safeParse({ ...VALID, weightGrams: -1 }).success).toBe(false);
  });
});

describe("VariantUpdateSchema (PATCH)", () => {
  it("пустой объект → ok (no-op)", () => {
    expect(VariantUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("только {priceCents} → ok", () => {
    expect(VariantUpdateSchema.safeParse({ priceCents: 200 }).success).toBe(true);
  });

  it("только {oldPriceCents} БЕЗ priceCents в payload → ok (refine пропускает)", () => {
    expect(VariantUpdateSchema.safeParse({ oldPriceCents: 100 }).success).toBe(true);
  });

  it("oldPriceCents + priceCents с invalid соотношением → fail", () => {
    expect(VariantUpdateSchema.safeParse({ priceCents: 200, oldPriceCents: 100 }).success).toBe(
      false,
    );
  });

  it("oldPriceCents = null → ok (clear oldPrice)", () => {
    expect(VariantUpdateSchema.safeParse({ oldPriceCents: null }).success).toBe(true);
  });

  it("invalid sku → fail", () => {
    expect(VariantUpdateSchema.safeParse({ sku: "lowercase" }).success).toBe(false);
  });
});
