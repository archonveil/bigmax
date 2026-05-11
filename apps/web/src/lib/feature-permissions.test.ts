/**
 * FF-011: pure-helper canChangeFeature.
 */

import { describe, expect, it } from "vitest";

import { canChangeFeature } from "./feature-permissions";

describe("canChangeFeature", () => {
  describe("loyalty.* — только admin", () => {
    it("admin может", () => {
      expect(canChangeFeature("admin", "loyalty.earn_percent")).toBe(true);
      expect(canChangeFeature("admin", "loyalty.spend_enabled")).toBe(true);
      expect(canChangeFeature("admin", "loyalty.future_flag")).toBe(true);
    });

    it("manager НЕ может", () => {
      expect(canChangeFeature("manager", "loyalty.earn_percent")).toBe(false);
      expect(canChangeFeature("manager", "loyalty.spend_enabled")).toBe(false);
    });
  });

  describe("non-loyalty — admin + manager", () => {
    it("admin может", () => {
      expect(canChangeFeature("admin", "brand.maintenance_message")).toBe(true);
    });

    it("manager может", () => {
      expect(canChangeFeature("manager", "brand.maintenance_message")).toBe(true);
      expect(canChangeFeature("manager", "some.random.flag")).toBe(true);
    });
  });

  describe("ключ-самозванец `loyalty` без точки", () => {
    it("НЕ matches `loyalty.*` (используется startsWith)", () => {
      // Защита от подмены: ключ должен начинаться РОВНО на `loyalty.`,
      // не просто `loyalty`.
      expect(canChangeFeature("manager", "loyalty")).toBe(true);
      expect(canChangeFeature("manager", "loyaltyspend")).toBe(true);
    });

    it("loyalty. с точкой → ловится", () => {
      expect(canChangeFeature("manager", "loyalty.")).toBe(false);
    });
  });
});
