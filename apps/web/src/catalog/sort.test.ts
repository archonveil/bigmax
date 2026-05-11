import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRODUCT_SORT,
  isProductSort,
  parseProductSort,
  PRODUCT_SORT_OPTIONS,
  sortQueryValue,
  sortRequiresInMemory,
} from "./sort";

describe("PRODUCT_SORT_OPTIONS", () => {
  it("is the expected literal list (spec lock)", () => {
    expect(PRODUCT_SORT_OPTIONS).toEqual(["featured", "newest", "price_asc", "price_desc"]);
  });

  it("default is featured", () => {
    expect(DEFAULT_PRODUCT_SORT).toBe("featured");
  });
});

describe("isProductSort", () => {
  it.each(PRODUCT_SORT_OPTIONS)("accepts %s", (s) => {
    expect(isProductSort(s)).toBe(true);
  });

  it("rejects random strings", () => {
    expect(isProductSort("cheapest")).toBe(false);
    expect(isProductSort("")).toBe(false);
    expect(isProductSort(undefined)).toBe(false);
    expect(isProductSort(42)).toBe(false);
  });
});

describe("parseProductSort", () => {
  it("falls back to default on undefined / invalid", () => {
    expect(parseProductSort(undefined)).toBe("featured");
    expect(parseProductSort("random")).toBe("featured");
  });

  it("takes first from array", () => {
    expect(parseProductSort(["newest", "price_asc"])).toBe("newest");
  });

  it("accepts known values", () => {
    expect(parseProductSort("newest")).toBe("newest");
    expect(parseProductSort("price_asc")).toBe("price_asc");
    expect(parseProductSort("price_desc")).toBe("price_desc");
  });
});

describe("sortQueryValue", () => {
  it("null for default (we skip default in URL)", () => {
    expect(sortQueryValue("featured")).toBeNull();
  });

  it("echoes non-default values", () => {
    expect(sortQueryValue("newest")).toBe("newest");
    expect(sortQueryValue("price_asc")).toBe("price_asc");
  });
});

describe("sortRequiresInMemory", () => {
  it("only price_asc / price_desc need in-memory sort (Prisma limitation)", () => {
    expect(sortRequiresInMemory("featured")).toBe(false);
    expect(sortRequiresInMemory("newest")).toBe(false);
    expect(sortRequiresInMemory("price_asc")).toBe(true);
    expect(sortRequiresInMemory("price_desc")).toBe(true);
  });
});
