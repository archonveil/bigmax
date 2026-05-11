/**
 * Pure-helpers тесты для category-attributes (locale-pickers + расширенный
 * validateAttributes). validateAttributes покрыт также в admin-products.test.ts;
 * здесь — кейсы, которые добавились вместе с DB-driven config'ом
 * (text/multiselect/required/range_below_min/range_above_max).
 */

import { describe, expect, it } from "vitest";

import {
  pickHelpText,
  pickLabel,
  pickOptionLabel,
  pickUnit,
  validateAttributes,
  type CategoryAttributeConfig,
} from "./category-attributes";

const baseEnum: CategoryAttributeConfig = {
  id: "f1",
  categoryId: "c1",
  key: "fabric",
  kind: "enum",
  labelRu: "Ткань",
  labelUz: "Mato",
  labelEn: "Fabric",
  helpTextRu: "Подсказка",
  helpTextUz: "Yordam",
  helpTextEn: "Hint",
  isRequired: false,
  isFilterable: true,
  order: 1,
  options: [
    { value: "cotton", labelRu: "Хлопок", labelUz: "Paxta", labelEn: "Cotton" },
    { value: "wool", labelRu: "Шерсть", labelUz: "Jun", labelEn: "Wool" },
  ],
};

const baseRange: CategoryAttributeConfig = {
  id: "f2",
  categoryId: "c1",
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
  min: 50,
  max: 1000,
  step: null,
  unitRu: "мл",
  unitUz: "ml",
  unitEn: "ml",
};

const baseMultiselect: CategoryAttributeConfig = {
  id: "f3",
  categoryId: "c1",
  key: "tags",
  kind: "multiselect",
  labelRu: "Теги",
  labelUz: "Teglar",
  labelEn: "Tags",
  helpTextRu: null,
  helpTextUz: null,
  helpTextEn: null,
  isRequired: false,
  isFilterable: true,
  order: 1,
  options: [
    { value: "new", labelRu: "Новинка", labelUz: "Yangi", labelEn: "New" },
    { value: "sale", labelRu: "Скидка", labelUz: "Aksiya", labelEn: "Sale" },
  ],
};

const baseText: CategoryAttributeConfig = {
  id: "f4",
  categoryId: "c1",
  key: "made_in",
  kind: "text",
  labelRu: "Страна",
  labelUz: "Mamlakat",
  labelEn: "Country",
  helpTextRu: null,
  helpTextUz: null,
  helpTextEn: null,
  isRequired: false,
  isFilterable: false,
  order: 1,
};

describe("pickLabel", () => {
  it("ru → labelRu", () => {
    expect(pickLabel(baseEnum, "ru")).toBe("Ткань");
  });
  it("uz → labelUz", () => {
    expect(pickLabel(baseEnum, "uz")).toBe("Mato");
  });
  it("en → labelEn", () => {
    expect(pickLabel(baseEnum, "en")).toBe("Fabric");
  });
  it("uz пустой → fallback ru", () => {
    expect(pickLabel({ ...baseEnum, labelUz: "" }, "uz")).toBe("Ткань");
  });
});

describe("pickHelpText", () => {
  it("по locale", () => {
    expect(pickHelpText(baseEnum, "uz")).toBe("Yordam");
  });
  it("null когда не задано", () => {
    expect(pickHelpText(baseRange, "ru")).toBeNull();
  });
});

describe("pickOptionLabel", () => {
  it("по locale", () => {
    expect(pickOptionLabel(baseEnum.options[0]!, "en")).toBe("Cotton");
  });
});

describe("pickUnit", () => {
  it("по locale", () => {
    expect(pickUnit(baseRange as Extract<CategoryAttributeConfig, { kind: "range" }>, "ru")).toBe(
      "мл",
    );
  });
  it("null когда unit не задан", () => {
    const noUnit = { ...baseRange, unitRu: null, unitUz: null, unitEn: null };
    expect(
      pickUnit(noUnit as Extract<CategoryAttributeConfig, { kind: "range" }>, "ru"),
    ).toBeNull();
  });
});

describe("validateAttributes — расширенные кейсы", () => {
  it("multiselect happy", () => {
    const r = validateAttributes([baseMultiselect], { tags: ["new", "sale"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ tags: ["new", "sale"] });
  });

  it("multiselect: дубликаты убираются", () => {
    const r = validateAttributes([baseMultiselect], { tags: ["new", "new", "sale"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ tags: ["new", "sale"] });
  });

  it("multiselect: unknown value → enum_value_invalid", () => {
    const r = validateAttributes([baseMultiselect], { tags: ["new", "alien"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("enum_value_invalid");
  });

  it("multiselect: пустой массив игнорится", () => {
    const r = validateAttributes([baseMultiselect], { tags: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toBeNull();
  });

  it("multiselect: не массив → type_mismatch", () => {
    const r = validateAttributes([baseMultiselect], { tags: "new" as unknown as string[] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("type_mismatch");
  });

  it("text happy: тримит и обрезает до 500", () => {
    const r = validateAttributes([baseText], { made_in: "  Uzbekistan  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ made_in: "Uzbekistan" });
  });

  it("text: пустой после trim → null", () => {
    const r = validateAttributes([baseText], { made_in: "   " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toBeNull();
  });

  it("range below min → range_below_min", () => {
    const r = validateAttributes([baseRange], { volumeMl: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("range_below_min");
  });

  it("range above max → range_above_max", () => {
    const r = validateAttributes([baseRange], { volumeMl: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("range_above_max");
  });

  it("range в пределах min/max → ok", () => {
    const r = validateAttributes([baseRange], { volumeMl: 250 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sanitized).toEqual({ volumeMl: 250 });
  });

  it("required missing для multiselect (пустой массив) → required_missing", () => {
    const r = validateAttributes([{ ...baseMultiselect, isRequired: true }], { tags: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("required_missing");
  });

  it("required missing для text → required_missing", () => {
    const r = validateAttributes([{ ...baseText, isRequired: true }], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("required_missing");
  });
});
