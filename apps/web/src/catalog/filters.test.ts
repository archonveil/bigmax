import { describe, expect, it } from "vitest";

import {
  buildAttributeFiltersQueryString,
  buildFiltersQueryString,
  buildProductWhere,
  hasActiveAttributeFilters,
  hasActiveFilters,
  parseAttributeFilters,
  parseCategoryFilters,
  type CategoryFilters,
} from "./filters";

const cleared: CategoryFilters = {
  minPrice: undefined,
  maxPrice: undefined,
  brand: [],
  age: "any",
  gender: "any",
  inStock: false,
};

describe("parseCategoryFilters", () => {
  it("returns cleared defaults for empty input", () => {
    expect(parseCategoryFilters({})).toEqual(cleared);
  });

  it("coerces price strings → int", () => {
    const f = parseCategoryFilters({ minPrice: "100000", maxPrice: "500000" });
    expect(f.minPrice).toBe(100_000);
    expect(f.maxPrice).toBe(500_000);
  });

  it("drops non-numeric price input silently", () => {
    const f = parseCategoryFilters({ minPrice: "abc" });
    expect(f.minPrice).toBeUndefined();
  });

  it("accepts single-brand string and array", () => {
    expect(parseCategoryFilters({ brand: "chicco" }).brand).toEqual(["chicco"]);
    expect(parseCategoryFilters({ brand: ["chicco", "pampers"] }).brand).toEqual([
      "chicco",
      "pampers",
    ]);
  });

  it("trims brand slugs and drops empty", () => {
    expect(parseCategoryFilters({ brand: ["  chicco ", ""] }).brand).toEqual(["chicco"]);
  });

  it("parses age/gender enums and falls back on invalid", () => {
    expect(parseCategoryFilters({ age: "0-6" }).age).toBe("0-6");
    expect(parseCategoryFilters({ age: "99-9" })).toEqual(cleared); // bad enum → safeParse fails → cleared
    expect(parseCategoryFilters({ gender: "boy" }).gender).toBe("boy");
  });

  it("inStock accepts 'true' / true / '1'", () => {
    expect(parseCategoryFilters({ inStock: "true" }).inStock).toBe(true);
    expect(parseCategoryFilters({ inStock: "1" }).inStock).toBe(true);
    expect(parseCategoryFilters({ inStock: "false" }).inStock).toBe(false);
  });
});

describe("buildFiltersQueryString", () => {
  it("returns empty string for cleared filters", () => {
    expect(buildFiltersQueryString(cleared)).toBe("");
  });

  it("skips defaults (age=any, gender=any, inStock=false)", () => {
    expect(buildFiltersQueryString({ ...cleared, age: "any", gender: "any", inStock: false })).toBe(
      "",
    );
  });

  it("serializes multi-brand as repeated keys", () => {
    const qs = buildFiltersQueryString({
      ...cleared,
      brand: ["chicco", "pampers"],
    });
    expect(qs).toBe("brand=chicco&brand=pampers");
  });

  it("serializes all active fields", () => {
    const qs = buildFiltersQueryString({
      minPrice: 100000,
      maxPrice: 500000,
      brand: ["chicco"],
      age: "0-6",
      gender: "boy",
      inStock: true,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("minPrice")).toBe("100000");
    expect(params.get("maxPrice")).toBe("500000");
    expect(params.get("brand")).toBe("chicco");
    expect(params.get("age")).toBe("0-6");
    expect(params.get("gender")).toBe("boy");
    expect(params.get("inStock")).toBe("true");
  });
});

describe("hasActiveFilters", () => {
  it("false when cleared", () => {
    expect(hasActiveFilters(cleared)).toBe(false);
  });

  it("true on any single active field", () => {
    expect(hasActiveFilters({ ...cleared, minPrice: 1 })).toBe(true);
    expect(hasActiveFilters({ ...cleared, brand: ["x"] })).toBe(true);
    expect(hasActiveFilters({ ...cleared, age: "0-6" })).toBe(true);
    expect(hasActiveFilters({ ...cleared, gender: "boy" })).toBe(true);
    expect(hasActiveFilters({ ...cleared, inStock: true })).toBe(true);
  });
});

describe("buildProductWhere", () => {
  const CAT_IDS = ["cat-a", "cat-b"];

  it("bare: only isActive + categoryId.in", () => {
    const where = buildProductWhere(CAT_IDS, cleared);
    expect(where.isActive).toBe(true);
    expect(where.categoryId).toEqual({ in: CAT_IDS });
    expect(where.brand).toBeUndefined();
    expect(where.gender).toBeUndefined();
    expect(where.AND).toBeUndefined();
    expect(where.variants).toBeUndefined();
  });

  it("brand filter → slug.in", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, brand: ["chicco", "pampers"] });
    expect(where.brand).toEqual({ slug: { in: ["chicco", "pampers"] } });
  });

  it("gender=boy includes unisex too", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, gender: "boy" });
    expect(where.gender).toEqual({ in: ["boy", "unisex"] });
  });

  it("gender=unisex is strict", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, gender: "unisex" });
    expect(where.gender).toBe("unisex");
  });

  it("age range uses overlap conditions (ageFromMonths ≤ to, ageToMonths ≥ from)", () => {
    // "0-6" → filter.from=0, filter.to=6
    const where = buildProductWhere(CAT_IDS, { ...cleared, age: "0-6" });
    expect(where.AND).toHaveLength(2);
    // condition #1: ageFromMonths is null OR ≤ 6
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ ageFromMonths: null }, { ageFromMonths: { lte: 6 } }] },
        { OR: [{ ageToMonths: null }, { ageToMonths: { gte: 0 } }] },
      ]),
    );
  });

  it("age 24+ has only upper-bound condition (to=null)", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, age: "24+" });
    // from=24, to=null → only second condition (ageToMonths ≥ 24)
    expect(where.AND).toEqual([{ OR: [{ ageToMonths: null }, { ageToMonths: { gte: 24 } }] }]);
  });

  it("price filter converts sum → tiyins and lands under variants.some", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, minPrice: 100, maxPrice: 500 });
    expect(where.variants).toEqual({
      some: { priceCents: { gte: 10_000, lte: 50_000 } },
    });
  });

  it("inStock maps to variants.some.stock.some.quantity > 0", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, inStock: true });
    expect(where.variants).toEqual({
      some: { stock: { some: { quantity: { gt: 0 } } } },
    });
  });

  it("price + inStock combine under a single variants.some", () => {
    const where = buildProductWhere(CAT_IDS, {
      ...cleared,
      minPrice: 100,
      inStock: true,
    });
    expect(where.variants).toEqual({
      some: {
        priceCents: { gte: 10_000 },
        stock: { some: { quantity: { gt: 0 } } },
      },
    });
  });

  it("multiselect attribute → OR over equals + array_contains для каждого значения", () => {
    const where = buildProductWhere(CAT_IDS, cleared, { color: ["white", "blue"] });
    const and = (where.AND ?? []) as Array<Record<string, unknown>>;
    expect(and.length).toBe(1);
    const firstCond = and[0] as { OR: Array<Record<string, unknown>> };
    expect(firstCond.OR).toHaveLength(4);
    expect(firstCond.OR).toContainEqual({
      attributes: { path: ["color"], equals: "white" },
    });
    expect(firstCond.OR).toContainEqual({
      attributes: { path: ["color"], array_contains: "white" },
    });
    expect(firstCond.OR).toContainEqual({
      attributes: { path: ["color"], equals: "blue" },
    });
    expect(firstCond.OR).toContainEqual({
      attributes: { path: ["color"], array_contains: "blue" },
    });
  });
});

describe("parseAttributeFilters", () => {
  const known = new Set(["fabric", "isOrganic", "volumeMl"]);

  it("extracts enum / bool / range из ?attr.* params", () => {
    const parsed = parseAttributeFilters(
      {
        "attr.fabric": "cotton",
        "attr.isOrganic": "true",
        "attr.volumeMl.min": "100",
        "attr.volumeMl.max": "500",
      },
      known,
    );
    expect(parsed).toEqual({
      fabric: "cotton",
      isOrganic: "true",
      volumeMl: { min: 100, max: 500 },
    });
  });

  it("игнорирует неизвестные ключи (не в knownKeys)", () => {
    const parsed = parseAttributeFilters(
      { "attr.nonexistent": "x", "attr.fabric": "cotton" },
      known,
    );
    expect(parsed).toEqual({ fabric: "cotton" });
  });

  it("игнорирует отрицательные numeric'и и NaN", () => {
    const parsed = parseAttributeFilters(
      {
        "attr.volumeMl.min": "-5",
        "attr.volumeMl.max": "abc",
      },
      known,
    );
    expect(parsed).toEqual({});
  });

  it("возвращает {} для пустых searchParams", () => {
    expect(parseAttributeFilters({}, known)).toEqual({});
  });

  it("multi-value `attr.fabric=a&attr.fabric=b` → string[]", () => {
    const parsed = parseAttributeFilters({ "attr.fabric": ["cotton", "wool"] }, known);
    expect(parsed).toEqual({ fabric: ["cotton", "wool"] });
  });

  it("multi-value с одной непустой записью → string (не array)", () => {
    const parsed = parseAttributeFilters({ "attr.fabric": ["cotton"] }, known);
    expect(parsed).toEqual({ fabric: "cotton" });
  });

  it("multi-value: dedupe одинаковых значений", () => {
    const parsed = parseAttributeFilters({ "attr.fabric": ["cotton", "cotton", "wool"] }, known);
    expect(parsed).toEqual({ fabric: ["cotton", "wool"] });
  });
});

describe("buildAttributeFiltersQueryString", () => {
  it("пустой объект → пустая строка", () => {
    expect(buildAttributeFiltersQueryString({})).toBe("");
  });

  it("сериализует enum/bool/range с правильными ключами", () => {
    const qs = buildAttributeFiltersQueryString({
      fabric: "cotton",
      isOrganic: "true",
      volumeMl: { min: 100, max: 500 },
    });
    const params = new URLSearchParams(qs);
    expect(params.get("attr.fabric")).toBe("cotton");
    expect(params.get("attr.isOrganic")).toBe("true");
    expect(params.get("attr.volumeMl.min")).toBe("100");
    expect(params.get("attr.volumeMl.max")).toBe("500");
  });

  it("multiselect → repeated `attr.key=` params", () => {
    const qs = buildAttributeFiltersQueryString({ fabric: ["cotton", "wool"] });
    const params = new URLSearchParams(qs);
    expect(params.getAll("attr.fabric")).toEqual(["cotton", "wool"]);
  });
});

describe("hasActiveAttributeFilters", () => {
  it("false для пустого", () => {
    expect(hasActiveAttributeFilters({})).toBe(false);
  });
  it("true для строки", () => {
    expect(hasActiveAttributeFilters({ fabric: "cotton" })).toBe(true);
  });
  it("true для range с min или max", () => {
    expect(hasActiveAttributeFilters({ volumeMl: { min: 10 } })).toBe(true);
    expect(hasActiveAttributeFilters({ volumeMl: { max: 10 } })).toBe(true);
  });
  it("false для range без min/max", () => {
    expect(hasActiveAttributeFilters({ volumeMl: {} })).toBe(false);
  });
  it("true для multiselect с непустым массивом", () => {
    expect(hasActiveAttributeFilters({ fabric: ["cotton", "wool"] })).toBe(true);
  });
  it("false для пустого multiselect", () => {
    expect(hasActiveAttributeFilters({ fabric: [] })).toBe(false);
  });
});

describe("hasActiveFilters includes attributes", () => {
  it("true если активен только attribute-фильтр", () => {
    expect(hasActiveFilters(cleared, { fabric: "cotton" })).toBe(true);
  });
});

describe("buildProductWhere with attributes", () => {
  const CAT_IDS = ["cat-a"];
  it("enum/multiselect attr → OR(equals, array_contains) для cross-storage match", () => {
    const where = buildProductWhere(CAT_IDS, cleared, { fabric: "cotton" });
    expect(where.AND).toEqual([
      {
        OR: [
          { attributes: { path: ["fabric"], equals: "cotton" } },
          { attributes: { path: ["fabric"], array_contains: "cotton" } },
        ],
      },
    ]);
  });
  it("bool 'true' → equals:true", () => {
    const where = buildProductWhere(CAT_IDS, cleared, { isOrganic: "true" });
    expect(where.AND).toEqual([{ attributes: { path: ["isOrganic"], equals: true } }]);
  });
  it("bool 'false' → equals:false", () => {
    const where = buildProductWhere(CAT_IDS, cleared, { hasSound: "false" });
    expect(where.AND).toEqual([{ attributes: { path: ["hasSound"], equals: false } }]);
  });
  it("range → gte + lte под AND", () => {
    const where = buildProductWhere(CAT_IDS, cleared, { volumeMl: { min: 100, max: 500 } });
    expect(where.AND).toEqual([
      { attributes: { path: ["volumeMl"], gte: 100 } },
      { attributes: { path: ["volumeMl"], lte: 500 } },
    ]);
  });
  it("attribute AND не затирает age AND (merge)", () => {
    const where = buildProductWhere(CAT_IDS, { ...cleared, age: "0-6" }, { fabric: "cotton" });
    // age adds 2 conditions + fabric adds 1 → AND has 3.
    expect(where.AND).toHaveLength(3);
  });
});

describe("buildFiltersQueryString with attributes", () => {
  it("merges core filters + attribute filters", () => {
    const qs = buildFiltersQueryString({ ...cleared, gender: "boy" }, { fabric: "cotton" });
    const params = new URLSearchParams(qs);
    expect(params.get("gender")).toBe("boy");
    expect(params.get("attr.fabric")).toBe("cotton");
  });
});
