/**
 * P6-T3: pure-валидаторы / парсеры admin-products.
 * Server-fetch (Prisma) покрывается e2e через seeded товары.
 */

import { describe, expect, it } from "vitest";

import type { CategoryAttributeConfig } from "@/catalog/category-attributes";

import {
  parseAdminProductListQuery,
  parseCsv,
  ProductCreateSchema,
  ProductCsvRowSchema,
  ProductUpdateSchema,
  validateAttributes,
} from "./admin-products";

const VALID_CREATE = {
  categoryId: "cat_1",
  brandId: "brand_1",
  nameRu: "Подгузники Pampers Premium Care",
  nameUz: "Pampers Premium Care taglik",
  nameEn: "Pampers Premium Care diapers",
  slug: "pampers-premium-care-3",
  ageFromMonths: 0,
  ageToMonths: 12,
  gender: "unisex",
  isActive: true,
  isFeatured: false,
};

describe("parseAdminProductListQuery", () => {
  it("дефолты: q null, active null, page 1", () => {
    expect(parseAdminProductListQuery(undefined)).toEqual({ q: null, active: null, page: 1 });
  });

  it("?q=pampers → trimmed string", () => {
    expect(parseAdminProductListQuery({ q: "  pampers  " })).toEqual({
      q: "pampers",
      active: null,
      page: 1,
    });
  });

  it("?q пустой / только-пробелы → null", () => {
    expect(parseAdminProductListQuery({ q: "  " }).q).toBeNull();
  });

  it("?q длиннее 200 → обрезается", () => {
    const result = parseAdminProductListQuery({ q: "a".repeat(500) });
    expect(result.q).toHaveLength(200);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("?active=%s → %s", (input, expected) => {
    expect(parseAdminProductListQuery({ active: input }).active).toBe(expected);
  });

  it("?active=foo / отсутствует → null", () => {
    expect(parseAdminProductListQuery({ active: "garbage" }).active).toBeNull();
    expect(parseAdminProductListQuery({}).active).toBeNull();
  });

  it("page sanitize (NaN, 0, -5, float) → 1 / floor", () => {
    expect(parseAdminProductListQuery({ page: "abc" }).page).toBe(1);
    expect(parseAdminProductListQuery({ page: "0" }).page).toBe(1);
    expect(parseAdminProductListQuery({ page: "-5" }).page).toBe(1);
    expect(parseAdminProductListQuery({ page: "3.7" }).page).toBe(3);
  });
});

describe("ProductCreateSchema", () => {
  it("валидное создание → ok", () => {
    expect(ProductCreateSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("без brandId → ok (бренд опционален)", () => {
    const { brandId, ...rest } = VALID_CREATE;
    void brandId;
    expect(ProductCreateSchema.safeParse(rest).success).toBe(true);
  });

  it("brandId: null → ok", () => {
    expect(ProductCreateSchema.safeParse({ ...VALID_CREATE, brandId: null }).success).toBe(true);
  });

  it("nameRu < 2 char → name_ru_too_short", () => {
    const r = ProductCreateSchema.safeParse({ ...VALID_CREATE, nameRu: "X" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("name_ru_too_short");
  });

  it("name > 200 → name_too_long", () => {
    const r = ProductCreateSchema.safeParse({ ...VALID_CREATE, nameRu: "x".repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("name_too_long");
  });

  it("slug с заглавными → slug_invalid", () => {
    const r = ProductCreateSchema.safeParse({ ...VALID_CREATE, slug: "Pampers" });
    expect(r.success).toBe(false);
  });

  it("slug с пробелом → slug_invalid", () => {
    expect(ProductCreateSchema.safeParse({ ...VALID_CREATE, slug: "pampers care" }).success).toBe(
      false,
    );
  });

  it("slug одной буквы → slug_too_short (min 2)", () => {
    expect(ProductCreateSchema.safeParse({ ...VALID_CREATE, slug: "a" }).success).toBe(false);
  });

  it("ageFromMonths > ageToMonths → age_range_invalid", () => {
    const r = ProductCreateSchema.safeParse({
      ...VALID_CREATE,
      ageFromMonths: 24,
      ageToMonths: 12,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("age_range_invalid");
  });

  it("equal ages (12-12) → ok", () => {
    expect(
      ProductCreateSchema.safeParse({ ...VALID_CREATE, ageFromMonths: 12, ageToMonths: 12 })
        .success,
    ).toBe(true);
  });

  it("один age указан, другой null → ok", () => {
    expect(
      ProductCreateSchema.safeParse({ ...VALID_CREATE, ageFromMonths: 6, ageToMonths: null })
        .success,
    ).toBe(true);
  });

  it("gender дефолт = unisex", () => {
    const { gender, ...rest } = VALID_CREATE;
    void gender;
    const r = ProductCreateSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.gender).toBe("unisex");
  });

  it("неизвестный gender → fail", () => {
    expect(ProductCreateSchema.safeParse({ ...VALID_CREATE, gender: "robot" }).success).toBe(false);
  });
});

describe("ProductUpdateSchema (PATCH)", () => {
  it("пустой объект → ok (no-op PATCH)", () => {
    expect(ProductUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("только {isActive: false} → ok", () => {
    expect(ProductUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it("только {nameRu: ...} → ok", () => {
    expect(ProductUpdateSchema.safeParse({ nameRu: "Новое имя" }).success).toBe(true);
  });

  it("ageFromMonths > ageToMonths → fail (refine работает в partial)", () => {
    expect(ProductUpdateSchema.safeParse({ ageFromMonths: 24, ageToMonths: 12 }).success).toBe(
      false,
    );
  });

  it("ageFromMonths указан, ageToMonths не указан → ok (refine пропускает)", () => {
    expect(ProductUpdateSchema.safeParse({ ageFromMonths: 12 }).success).toBe(true);
  });
});

describe("parseCsv", () => {
  it("пустой текст → empty", () => {
    expect(parseCsv("")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("только header без data → empty (нужно ≥2 строки)", () => {
    expect(parseCsv("slug,name_ru,name_uz,name_en,category_slug")).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("header без обязательных колонок → missing_columns", () => {
    const r = parseCsv("name_ru\nx");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "missing_columns") {
      expect(r.missing).toContain("slug");
      expect(r.missing).toContain("category_slug");
    }
  });

  it("happy: header + 2 row → 2 объекта", () => {
    const csv = `slug,name_ru,name_uz,name_en,category_slug
test-1,Тест 1,Test 1 uz,Test 1 en,toys
test-2,Тест 2,Test 2 uz,Test 2 en,food`;
    const r = parseCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]).toMatchObject({ slug: "test-1", name_ru: "Тест 1", category_slug: "toys" });
    }
  });

  it("CRLF line endings нормализуются", () => {
    const csv = "slug,name_ru,name_uz,name_en,category_slug\r\ntest-1,A,B,C,toys";
    const r = parseCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(1);
  });

  it("пустые ячейки не попадают в row", () => {
    const csv = `slug,name_ru,name_uz,name_en,category_slug,brand_slug
test,A,B,C,toys,`;
    const r = parseCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0]).not.toHaveProperty("brand_slug");
    }
  });

  it("пустые строки между data игнорируются", () => {
    const csv = `slug,name_ru,name_uz,name_en,category_slug
test-1,A,B,C,toys

test-2,D,E,F,food`;
    const r = parseCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });
});

describe("ProductCsvRowSchema", () => {
  const VALID = {
    slug: "test-product",
    name_ru: "Тест",
    name_uz: "Test",
    name_en: "Test",
    category_slug: "toys",
  };

  it("минимальная row (3 обязательных поля: slug + name_ru + category_slug) → ok", () => {
    expect(ProductCsvRowSchema.safeParse(VALID).success).toBe(true);
  });

  it("name_uz и name_en опциональны → ok без них", () => {
    const { name_uz, name_en, ...minimal } = VALID;
    void name_uz;
    void name_en;
    expect(ProductCsvRowSchema.safeParse(minimal).success).toBe(true);
  });

  it("age_from_months coerce из строки '6' → 6", () => {
    const r = ProductCsvRowSchema.safeParse({ ...VALID, age_from_months: "6" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.age_from_months).toBe(6);
  });

  it("age_from_months '-1' → fail (min 0)", () => {
    expect(ProductCsvRowSchema.safeParse({ ...VALID, age_from_months: "-1" }).success).toBe(false);
  });

  it("неизвестный gender → fail", () => {
    expect(ProductCsvRowSchema.safeParse({ ...VALID, gender: "alien" }).success).toBe(false);
  });

  it("опциональные поля можно опустить", () => {
    const r = ProductCsvRowSchema.safeParse({ ...VALID, brand_slug: "nuby" });
    expect(r.success).toBe(true);
  });
});

// Test fixtures (DB-driven shape — заменяет прежние slug-based тесты).
const CONFIG_CLOTHING: CategoryAttributeConfig[] = [
  {
    id: "f1",
    categoryId: "c1",
    key: "fabric",
    kind: "enum",
    labelRu: "Ткань",
    labelUz: "Mato",
    labelEn: "Fabric",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
    isRequired: false,
    isFilterable: true,
    order: 1,
    options: [
      { value: "cotton", labelRu: "Хлопок", labelUz: "Paxta", labelEn: "Cotton" },
      { value: "wool", labelRu: "Шерсть", labelUz: "Jun", labelEn: "Wool" },
    ],
  },
  {
    id: "f2",
    categoryId: "c1",
    key: "season",
    kind: "enum",
    labelRu: "Сезон",
    labelUz: "Mavsum",
    labelEn: "Season",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
    isRequired: false,
    isFilterable: true,
    order: 2,
    options: [
      { value: "summer", labelRu: "Лето", labelUz: "Yoz", labelEn: "Summer" },
      { value: "winter", labelRu: "Зима", labelUz: "Qish", labelEn: "Winter" },
    ],
  },
];

const CONFIG_FOOD: CategoryAttributeConfig[] = [
  {
    id: "f3",
    categoryId: "c2",
    key: "volumeMl",
    kind: "range",
    labelRu: "Объём",
    labelUz: "Hajmi",
    labelEn: "Volume",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
    isRequired: false,
    isFilterable: true,
    order: 1,
    min: 0,
    max: null,
    step: null,
    unitRu: "мл",
    unitUz: "ml",
    unitEn: "ml",
  },
  {
    id: "f4",
    categoryId: "c2",
    key: "isOrganic",
    kind: "boolean",
    labelRu: "Органический",
    labelUz: "Organik",
    labelEn: "Organic",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
    isRequired: false,
    isFilterable: true,
    order: 2,
  },
];

const CONFIG_TOYS: CategoryAttributeConfig[] = [
  {
    id: "f5",
    categoryId: "c3",
    key: "hasSound",
    kind: "boolean",
    labelRu: "Со звуком",
    labelUz: "Ovozli",
    labelEn: "With sound",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
    isRequired: false,
    isFilterable: true,
    order: 1,
  },
];

describe("validateAttributes", () => {
  it("null/empty → ok с null", () => {
    expect(validateAttributes(CONFIG_CLOTHING, null)).toEqual({ ok: true, sanitized: null });
    expect(validateAttributes(CONFIG_CLOTHING, {})).toEqual({ ok: true, sanitized: null });
    expect(validateAttributes(CONFIG_CLOTHING, undefined)).toEqual({ ok: true, sanitized: null });
  });

  it("пустой config → ok с null (даже если admin прислал значения)", () => {
    expect(validateAttributes([], { fabric: "cotton" })).toEqual({
      ok: true,
      sanitized: null,
    });
  });

  it("clothing happy: fabric + season", () => {
    const r = validateAttributes(CONFIG_CLOTHING, { fabric: "cotton", season: "summer" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ fabric: "cotton", season: "summer" });
  });

  it("clothing: unknown key (material) silently игнорится", () => {
    const r = validateAttributes(CONFIG_CLOTHING, { fabric: "cotton", material: "wood" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ fabric: "cotton" });
  });

  it("enum value не в options → enum_value_invalid", () => {
    const r = validateAttributes(CONFIG_CLOTHING, { fabric: "alien-material" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.key).toBe("fabric");
      expect(r.reason).toBe("enum_value_invalid");
    }
  });

  it("enum value не string → type_mismatch", () => {
    const r = validateAttributes(CONFIG_CLOTHING, { fabric: 42 as unknown as string });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.key).toBe("fabric");
      expect(r.reason).toBe("type_mismatch");
    }
  });

  it("range happy: volumeMl=250", () => {
    const r = validateAttributes(CONFIG_FOOD, { volumeMl: 250, isOrganic: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ volumeMl: 250, isOrganic: true });
  });

  it("range negative → range_negative", () => {
    const r = validateAttributes(CONFIG_FOOD, { volumeMl: -10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("range_negative");
  });

  it("range non-number → type_mismatch", () => {
    const r = validateAttributes(CONFIG_FOOD, { volumeMl: "abc" as unknown as number });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("type_mismatch");
  });

  it("boolean non-boolean → type_mismatch", () => {
    const r = validateAttributes(CONFIG_TOYS, { hasSound: "yes" as unknown as boolean });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("type_mismatch");
  });

  it("пустые/null значения отбрасываются", () => {
    const r = validateAttributes(CONFIG_CLOTHING, {
      fabric: "",
      season: null as unknown as string,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toBeNull();
  });

  it("required field missing → required_missing", () => {
    const reqCfg: CategoryAttributeConfig[] = [{ ...CONFIG_CLOTHING[0]!, isRequired: true }];
    const r = validateAttributes(reqCfg, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.key).toBe("fabric");
      expect(r.reason).toBe("required_missing");
    }
  });
});
