import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALES, isLocale, localized } from "./locales";

describe("locales", () => {
  it("has exactly ru/uz/en in that order with ru as default", () => {
    expect(LOCALES).toEqual(["ru", "uz", "en"]);
    expect(DEFAULT_LOCALE).toBe("ru");
  });

  it("isLocale rejects anything outside of ru/uz/en", () => {
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("uz")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("kk")).toBe(false);
    expect(isLocale("uz-Cyrl")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("localized()", () => {
  const product = {
    nameRu: "Боди Chicco",
    nameUz: "Chicco bodi",
    nameEn: "Chicco bodysuit",
  };

  it("returns the value for the requested locale", () => {
    expect(localized(product, "name", "ru")).toBe("Боди Chicco");
    expect(localized(product, "name", "uz")).toBe("Chicco bodi");
    expect(localized(product, "name", "en")).toBe("Chicco bodysuit");
  });

  it("falls back to ru when requested locale is missing or empty", () => {
    const partial = { nameRu: "Боди", nameUz: null, nameEn: "" };
    expect(localized(partial, "name", "uz")).toBe("Боди");
    expect(localized(partial, "name", "en")).toBe("Боди");
  });

  it("returns empty string when even ru is missing", () => {
    const empty = { nameRu: null, nameUz: null, nameEn: null };
    expect(localized(empty, "name", "uz")).toBe("");
  });
});
