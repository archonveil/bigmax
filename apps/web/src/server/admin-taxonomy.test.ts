/**
 * P6-T4: Zod-схемы для CRUD категорий, брендов, филиалов.
 */

import { describe, expect, it } from "vitest";

import {
  BrandCreateSchema,
  BrandUpdateSchema,
  BranchCreateSchema,
  BranchUpdateSchema,
  CategoryCreateSchema,
  CategoryUpdateSchema,
} from "./admin-taxonomy";

const VALID_CAT = {
  nameRu: "Подгузники",
  nameUz: "Tagliklar",
  nameEn: "Diapers",
  slug: "diapers",
  parentId: null,
  iconUrl: null,
  order: 0,
  isActive: true,
};

const VALID_BRAND = {
  name: "Pampers",
  slug: "pampers",
  logoUrl: null,
  description: null,
  country: "USA",
};

const VALID_BRANCH = {
  nameRu: "Главный",
  nameUz: "Asosiy",
  nameEn: "Main",
  addressRu: "Ташкент, ул. Амира Темура, 12",
  addressUz: "Toshkent, Amir Temur ko'chasi, 12",
  addressEn: "Tashkent, Amir Temur St., 12",
  phone: "+998901234567",
  workingHours: "Пн-Вс 09:00-21:00",
  latitude: 41.31,
  longitude: 69.28,
  isActive: true,
};

describe("CategoryCreateSchema", () => {
  it("happy → ok", () => {
    expect(CategoryCreateSchema.safeParse(VALID_CAT).success).toBe(true);
  });

  it("nameRu < 2 → name_ru_too_short", () => {
    const r = CategoryCreateSchema.safeParse({ ...VALID_CAT, nameRu: "X" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("name_ru_too_short");
  });

  it("slug uppercase → slug_invalid", () => {
    expect(CategoryCreateSchema.safeParse({ ...VALID_CAT, slug: "Diapers" }).success).toBe(false);
  });

  it("iconUrl невалидный → icon_url_invalid", () => {
    const r = CategoryCreateSchema.safeParse({ ...VALID_CAT, iconUrl: "not-a-url" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("icon_url_invalid");
  });

  it("iconUrl null → ok", () => {
    expect(CategoryCreateSchema.safeParse({ ...VALID_CAT, iconUrl: null }).success).toBe(true);
  });

  it("order дефолт = 0", () => {
    const { order, ...rest } = VALID_CAT;
    void order;
    const r = CategoryCreateSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.order).toBe(0);
  });

  it("parentId = null → ok (root)", () => {
    expect(CategoryCreateSchema.safeParse({ ...VALID_CAT, parentId: null }).success).toBe(true);
  });
});

describe("CategoryUpdateSchema", () => {
  it("пустой → ok", () => {
    expect(CategoryUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("только {isActive: false} → ok", () => {
    expect(CategoryUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it("invalid slug в PATCH → fail", () => {
    expect(CategoryUpdateSchema.safeParse({ slug: "BAD SLUG" }).success).toBe(false);
  });
});

describe("BrandCreateSchema", () => {
  it("happy → ok", () => {
    expect(BrandCreateSchema.safeParse(VALID_BRAND).success).toBe(true);
  });

  it("name 1 символ → name_too_short", () => {
    const r = BrandCreateSchema.safeParse({ ...VALID_BRAND, name: "X" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("name_too_short");
  });

  it("logoUrl невалидный → logo_url_invalid", () => {
    expect(BrandCreateSchema.safeParse({ ...VALID_BRAND, logoUrl: "abc" }).success).toBe(false);
  });

  it("country/description опц. → можно опустить", () => {
    expect(BrandCreateSchema.safeParse({ name: "Mini", slug: "mini" }).success).toBe(true);
  });
});

describe("BrandUpdateSchema", () => {
  it("пустой PATCH → ok", () => {
    expect(BrandUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("invalid slug → fail", () => {
    expect(BrandUpdateSchema.safeParse({ slug: "_bad" }).success).toBe(false);
  });
});

describe("BranchCreateSchema", () => {
  it("happy → ok", () => {
    expect(BranchCreateSchema.safeParse(VALID_BRANCH).success).toBe(true);
  });

  it("addressRu < 3 → address_ru_too_short", () => {
    const r = BranchCreateSchema.safeParse({ ...VALID_BRANCH, addressRu: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("address_ru_too_short");
  });

  it("latitude > 90 → fail", () => {
    expect(BranchCreateSchema.safeParse({ ...VALID_BRANCH, latitude: 91 }).success).toBe(false);
  });

  it("longitude < -180 → fail", () => {
    expect(BranchCreateSchema.safeParse({ ...VALID_BRANCH, longitude: -181 }).success).toBe(false);
  });

  it("без geo (lat/lng=null) → ok", () => {
    expect(
      BranchCreateSchema.safeParse({ ...VALID_BRANCH, latitude: null, longitude: null }).success,
    ).toBe(true);
  });

  it("phone опционален (null)", () => {
    expect(BranchCreateSchema.safeParse({ ...VALID_BRANCH, phone: null }).success).toBe(true);
  });
});

describe("BranchUpdateSchema", () => {
  it("пустой → ok", () => {
    expect(BranchUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("only isActive → ok", () => {
    expect(BranchUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it("invalid lat в PATCH → fail", () => {
    expect(BranchUpdateSchema.safeParse({ latitude: 100 }).success).toBe(false);
  });
});
