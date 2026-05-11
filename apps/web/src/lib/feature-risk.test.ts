/**
 * FF-003: pure-helper для high-risk feature changes.
 */

import { describe, expect, it } from "vitest";

import { isHighRiskFeatureChange } from "./feature-risk";

describe("isHighRiskFeatureChange", () => {
  describe("loyalty.spend_enabled", () => {
    it("true → false → high-risk", () => {
      expect(isHighRiskFeatureChange("loyalty.spend_enabled", "false")).toBe(true);
    });

    it("false → true → НЕ high-risk (включение фичи безопасно)", () => {
      expect(isHighRiskFeatureChange("loyalty.spend_enabled", "true")).toBe(false);
    });
  });

  describe("brand.maintenance_message", () => {
    it("→ непустая строка → high-risk", () => {
      expect(isHighRiskFeatureChange("brand.maintenance_message", "Сайт на обслуживании")).toBe(
        true,
      );
    });

    it("→ пустая строка → НЕ high-risk (banner скрывается)", () => {
      expect(isHighRiskFeatureChange("brand.maintenance_message", "")).toBe(false);
    });

    it("→ whitespace-only → НЕ high-risk", () => {
      expect(isHighRiskFeatureChange("brand.maintenance_message", "   ")).toBe(false);
    });
  });

  describe("loyalty.earn_percent", () => {
    it("≤ 5 → НЕ high-risk", () => {
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "1")).toBe(false);
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "5")).toBe(false);
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "0.5")).toBe(false);
    });

    it("> 5 → high-risk (легко опечатка 50 вместо 5)", () => {
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "5.01")).toBe(true);
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "10")).toBe(true);
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "50")).toBe(true);
    });

    it("not-a-number → НЕ high-risk (validation поймает на сервере)", () => {
      expect(isHighRiskFeatureChange("loyalty.earn_percent", "abc")).toBe(false);
    });
  });

  describe("неизвестный ключ", () => {
    it("→ НЕ high-risk (default — безопасный)", () => {
      expect(isHighRiskFeatureChange("some.random.flag", "false")).toBe(false);
      expect(isHighRiskFeatureChange("some.random.flag", "anything")).toBe(false);
    });
  });
});
