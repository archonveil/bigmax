import { describe, expect, it } from "vitest";

import { centsToDecimalString, centsToSum, formatCurrencyUzs, sumToCents } from "./money";

describe("centsToSum / sumToCents", () => {
  it("roundtrips", () => {
    expect(centsToSum(150_000_000)).toBe(1_500_000);
    expect(sumToCents(1_500_000)).toBe(150_000_000);
  });
});

describe("centsToDecimalString (Uniteller Subtotal_P)", () => {
  it("formats as integer sum with two-digit fractional тийны", () => {
    // Пример из спеки 6.9: 1_500_000 тийнов → "15000.00"
    expect(centsToDecimalString(1_500_000)).toBe("15000.00");
    expect(centsToDecimalString(150_000_000)).toBe("1500000.00");
    expect(centsToDecimalString(100)).toBe("1.00");
    expect(centsToDecimalString(101)).toBe("1.01");
    expect(centsToDecimalString(99)).toBe("0.99");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("throws on non-integer or negative input", () => {
    expect(() => centsToDecimalString(-1)).toThrow(RangeError);
    expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
  });
});

describe("formatCurrencyUzs", () => {
  const cents = 150_000_000; // = 1 500 000 сум

  it("ru format: 1 500 000 сум", () => {
    expect(formatCurrencyUzs(cents, "ru")).toMatch(/^1.500.000.сум$/u);
  });

  it("uz format: 1 500 000 so'm", () => {
    expect(formatCurrencyUzs(cents, "uz")).toMatch(/^1.500.000.so'm$/u);
  });

  it("en format: 1,500,000 UZS", () => {
    expect(formatCurrencyUzs(cents, "en")).toMatch(/^1,500,000.UZS$/u);
  });

  it("negative cents показывает minus (ru): −1 500 сум", () => {
    // Intl ставит знак «−» или «-» в зависимости от браузера/ICU —
    // регексп принимает оба.
    expect(formatCurrencyUzs(-150_000, "ru")).toMatch(/^[-−]1.500.сум$/u);
  });

  it("signDisplay=always (en): +1,500 UZS", () => {
    expect(formatCurrencyUzs(150_000, "en", { signDisplay: "always" })).toMatch(/^\+1,500.UZS$/u);
  });

  it("signDisplay=never отключает минус для отрицательных", () => {
    expect(formatCurrencyUzs(-150_000, "en", { signDisplay: "never" })).toMatch(/^1,500.UZS$/u);
  });
});
