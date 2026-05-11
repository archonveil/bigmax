/**
 * Pure-валидаторы для admin-category-attributes (Zod schemas).
 * I/O (Prisma) покрывается e2e через seeded категории.
 */

import { describe, expect, it } from "vitest";

import {
  CategoryAttributeCreateSchema,
  CategoryAttributeReorderSchema,
  CategoryAttributeUpdateSchema,
} from "./admin-category-attributes";

const VALID_ENUM = {
  key: "fabric",
  kind: "enum" as const,
  labelRu: "Ткань",
  labelUz: "Mato",
  labelEn: "Fabric",
  options: [{ value: "cotton", labelRu: "Хлопок", labelUz: "Paxta", labelEn: "Cotton" }],
};

const VALID_RANGE = {
  key: "volume_ml",
  kind: "range" as const,
  labelRu: "Объём",
  labelUz: "Hajmi",
  labelEn: "Volume",
  min: 0,
  max: 1000,
  unitRu: "мл",
  unitUz: "ml",
  unitEn: "ml",
};

const VALID_BOOLEAN = {
  key: "has_sound",
  kind: "boolean" as const,
  labelRu: "Со звуком",
  labelUz: "Ovozli",
  labelEn: "With sound",
};

describe("CategoryAttributeCreateSchema", () => {
  it("happy enum", () => {
    expect(CategoryAttributeCreateSchema.safeParse(VALID_ENUM).success).toBe(true);
  });

  it("happy range", () => {
    expect(CategoryAttributeCreateSchema.safeParse(VALID_RANGE).success).toBe(true);
  });

  it("happy boolean", () => {
    expect(CategoryAttributeCreateSchema.safeParse(VALID_BOOLEAN).success).toBe(true);
  });

  it("invalid kind → fail", () => {
    expect(CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, kind: "color" }).success).toBe(
      false,
    );
  });

  it("key с дефисом → fail (только underscore)", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, key: "my-key" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("key_invalid");
  });

  it("key начинается с цифры → fail", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, key: "1foo" });
    expect(r.success).toBe(false);
  });

  it("enum без options → options_required", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, options: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.message === "options_required")).toBe(true);
  });

  it("enum с options=null → options_required", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, options: null });
    expect(r.success).toBe(false);
  });

  it("multiselect без options → options_required", () => {
    const r = CategoryAttributeCreateSchema.safeParse({
      ...VALID_ENUM,
      kind: "multiselect" as const,
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it("range с min > max → range_invalid", () => {
    const r = CategoryAttributeCreateSchema.safeParse({
      ...VALID_RANGE,
      min: 100,
      max: 10,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.message === "range_invalid")).toBe(true);
  });

  it("range с min=null + max=10 → ok", () => {
    expect(
      CategoryAttributeCreateSchema.safeParse({ ...VALID_RANGE, min: null, max: 10 }).success,
    ).toBe(true);
  });

  it("boolean без options — ok (kind не требует)", () => {
    expect(CategoryAttributeCreateSchema.safeParse(VALID_BOOLEAN).success).toBe(true);
  });

  it("text без options — ok", () => {
    const r = CategoryAttributeCreateSchema.safeParse({
      ...VALID_BOOLEAN,
      kind: "text" as const,
    });
    expect(r.success).toBe(true);
  });

  it("strict: extra поле → fail", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, extra: "x" });
    expect(r.success).toBe(false);
  });

  it("опции с invalid value (заглавная) → option_value_invalid", () => {
    const r = CategoryAttributeCreateSchema.safeParse({
      ...VALID_ENUM,
      options: [{ value: "Cotton", labelRu: "Х", labelUz: "P", labelEn: "C" }],
    });
    expect(r.success).toBe(false);
  });

  it("label пустой → label_required", () => {
    const r = CategoryAttributeCreateSchema.safeParse({ ...VALID_ENUM, labelRu: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("label_required");
  });
});

describe("CategoryAttributeUpdateSchema", () => {
  it("happy: partial update", () => {
    expect(CategoryAttributeUpdateSchema.safeParse({ labelRu: "Новое название" }).success).toBe(
      true,
    );
  });

  it("happy: empty body — ok (PATCH без изменений валиден)", () => {
    expect(CategoryAttributeUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("strict: kind в body → fail (нельзя менять)", () => {
    expect(CategoryAttributeUpdateSchema.safeParse({ kind: "range" }).success).toBe(false);
  });

  it("strict: key в body → fail (нельзя менять)", () => {
    expect(CategoryAttributeUpdateSchema.safeParse({ key: "newkey" }).success).toBe(false);
  });

  it("happy: помечаем required", () => {
    expect(CategoryAttributeUpdateSchema.safeParse({ isRequired: true }).success).toBe(true);
  });

  it("happy: добавляем helpText", () => {
    expect(
      CategoryAttributeUpdateSchema.safeParse({
        helpTextRu: "Подсказка",
        helpTextUz: "Yordam",
        helpTextEn: "Hint",
      }).success,
    ).toBe(true);
  });
});

describe("CategoryAttributeReorderSchema", () => {
  it("happy: массив id'ов", () => {
    expect(CategoryAttributeReorderSchema.safeParse({ orderedIds: ["a", "b", "c"] }).success).toBe(
      true,
    );
  });

  it("пустой массив → fail", () => {
    expect(CategoryAttributeReorderSchema.safeParse({ orderedIds: [] }).success).toBe(false);
  });

  it("strict: extra поле → fail", () => {
    expect(
      CategoryAttributeReorderSchema.safeParse({
        orderedIds: ["a"],
        extra: "x",
      }).success,
    ).toBe(false);
  });

  it("не-строки в массиве → fail", () => {
    expect(
      CategoryAttributeReorderSchema.safeParse({
        orderedIds: ["a", 42],
      }).success,
    ).toBe(false);
  });
});
