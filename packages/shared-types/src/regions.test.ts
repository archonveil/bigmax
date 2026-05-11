import { describe, expect, it } from "vitest";

import {
  isUzRegionSlug,
  regionName,
  districtName,
  TASHKENT_CITY_SLUG,
  UZ_REGIONS,
  UZ_REGION_SLUGS,
} from "./regions";

describe("UZ_REGIONS", () => {
  it("has 14 entries (Karakalpakstan + 12 viloyats + Tashkent city)", () => {
    expect(UZ_REGIONS).toHaveLength(14);
  });

  it("has unique slugs", () => {
    expect(new Set(UZ_REGION_SLUGS).size).toBe(UZ_REGION_SLUGS.length);
  });

  it("every region has name in all three locales", () => {
    for (const r of UZ_REGIONS) {
      expect(r.nameRu.length).toBeGreaterThan(0);
      expect(r.nameUz.length).toBeGreaterThan(0);
      expect(r.nameEn.length).toBeGreaterThan(0);
    }
  });

  it("contains tashkent-city as a distinct entry", () => {
    expect(UZ_REGION_SLUGS).toContain(TASHKENT_CITY_SLUG);
  });
});

describe("isUzRegionSlug", () => {
  it("accepts known slugs, rejects everything else", () => {
    expect(isUzRegionSlug("bukhara")).toBe(true);
    expect(isUzRegionSlug(TASHKENT_CITY_SLUG)).toBe(true);
    expect(isUzRegionSlug("moscow")).toBe(false);
    expect(isUzRegionSlug("")).toBe(false);
    expect(isUzRegionSlug(42)).toBe(false);
    expect(isUzRegionSlug(null)).toBe(false);
  });
});

describe("regionName", () => {
  it("returns the localized name", () => {
    expect(regionName("bukhara", "ru")).toBe("Бухара");
    expect(regionName("bukhara", "uz")).toBe("Buxoro");
    expect(regionName("bukhara", "en")).toBe("Bukhara");
  });

  it("falls back to raw slug for unknown region", () => {
    expect(regionName("atlantis", "ru")).toBe("atlantis");
  });
});

describe("districtName", () => {
  it("returns localized district name for Tashkent districts", () => {
    expect(districtName("chilonzor", "ru")).toBe("Чиланзарский");
    expect(districtName("chilonzor", "uz")).toBe("Chilonzor");
    expect(districtName("chilonzor", "en")).toBe("Chilanzar");
  });
});
