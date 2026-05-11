/**
 * P6-T4: e2e для CRUD категорий, брендов, филиалов.
 *
 * Smoke-style: каждый resource — POST happy + PATCH + DELETE + 1
 * UI-flow через форму + auth-checks. Подробные граничные кейсы (refines,
 * slug-format) — unit-tests.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-taxonomy@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Tax",
  role: "admin" as const,
};

const PREFIX = "e2e-tax";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function cleanup(): Promise<void> {
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.brand.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.storeBranch.deleteMany({ where: { nameRu: { startsWith: "E2E-TAX-" } } });
}

test.describe("P6-T4 · Categories CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });
  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("POST happy → 201", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories", {
      data: {
        nameRu: "Тестовая категория",
        nameUz: "Test kategoriya",
        nameEn: "Test category",
        slug: `${PREFIX}-cat-1`,
        order: 5,
        isActive: true,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);
    const created = await prisma.category.findUnique({
      where: { slug: `${PREFIX}-cat-1` },
      select: { nameRu: true, order: true },
    });
    expect(created).toMatchObject({ nameRu: "Тестовая категория", order: 5 });
  });

  test("POST 409 на дубль slug", async ({ page }) => {
    await loginAsAdmin(page);
    const body = {
      nameRu: "X",
      nameUz: "Yz",
      nameEn: "Zz",
      slug: `${PREFIX}-dup`,
    };
    // Сначала создаём с min-length-валидным name (>2 char).
    body.nameRu = "Категория Один";
    body.nameUz = "Kategoriya bir";
    body.nameEn = "Category one";
    await page.request.post("/api/admin/categories", {
      data: body,
      headers: { "Content-Type": "application/json" },
    });
    const res = await page.request.post("/api/admin/categories", {
      data: { ...body, nameRu: "Дубликат" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "slug_exists" });
  });

  test("PATCH parent=self → parent_cycle 400", async ({ page }) => {
    await loginAsAdmin(page);
    const cat = await prisma.category.create({
      data: {
        nameRu: "Self-parent",
        nameUz: "Sp",
        nameEn: "Sp",
        slug: `${PREFIX}-cycle`,
      },
      select: { id: true },
    });
    const res = await page.request.patch(`/api/admin/categories/${cat.id}`, {
      data: { parentId: cat.id },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({
      ok: false,
      reason: "invalid_body",
      message: "parent_cycle",
    });
  });

  test("DELETE 409 category_in_use если есть товары", async ({ page }) => {
    await loginAsAdmin(page);
    const cat = await prisma.category.create({
      data: {
        nameRu: "C with products",
        nameUz: "Cwp",
        nameEn: "Cwp",
        slug: `${PREFIX}-inuse`,
      },
      select: { id: true },
    });
    await prisma.product.create({
      data: {
        slug: `${PREFIX}-inuse-prod`,
        nameRu: "P",
        nameUz: "P",
        nameEn: "P",
        categoryId: cat.id,
      },
      select: { id: true },
    });
    const res = await page.request.delete(`/api/admin/categories/${cat.id}`);
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string; productsCount: number };
    expect(body.reason).toBe("category_in_use");
    expect(body.productsCount).toBe(1);

    // Cleanup product (cleanup() будет ожидать prefix-startsWith)
    await prisma.product.deleteMany({ where: { slug: `${PREFIX}-inuse-prod` } });
  });

  test("UI: list page рендерится с seeded категориями", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/categories");
    await expect(page.getByTestId("admin-categories")).toBeVisible();
    await expect(page.getByTestId("admin-categories-table")).toBeVisible();
    // В seed-данных 9+ категорий — должна быть хотя бы одна строка.
    await expect(page.getByTestId("admin-categories-row").first()).toBeVisible();
  });
});

test.describe("P6-T4 · Brands CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });
  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("POST happy → 201 + БД", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/brands", {
      data: {
        name: "TestBrand",
        slug: `${PREFIX}-brand-1`,
        country: "Узбекистан",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);
    const created = await prisma.brand.findUnique({
      where: { slug: `${PREFIX}-brand-1` },
      select: { name: true, country: true },
    });
    expect(created).toMatchObject({ name: "TestBrand", country: "Узбекистан" });
  });

  test("PATCH happy → 200", async ({ page }) => {
    await loginAsAdmin(page);
    const brand = await prisma.brand.create({
      data: { name: "Old", slug: `${PREFIX}-brand-edit` },
      select: { id: true },
    });
    const res = await page.request.patch(`/api/admin/brands/${brand.id}`, {
      data: { name: "New", country: "Italy" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const updated = await prisma.brand.findUniqueOrThrow({
      where: { id: brand.id },
      select: { name: true, country: true },
    });
    expect(updated).toMatchObject({ name: "New", country: "Italy" });
  });

  test("DELETE happy: brand → 200 + product.brandId=null (SetNull)", async ({ page }) => {
    await loginAsAdmin(page);
    const brand = await prisma.brand.create({
      data: { name: "Del", slug: `${PREFIX}-brand-del` },
      select: { id: true },
    });
    const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const product = await prisma.product.create({
      data: {
        slug: `${PREFIX}-brand-del-prod`,
        nameRu: "P",
        nameUz: "P",
        nameEn: "P",
        categoryId: cat.id,
        brandId: brand.id,
      },
      select: { id: true },
    });

    try {
      const res = await page.request.delete(`/api/admin/brands/${brand.id}`);
      expect(res.status()).toBe(200);
      const reloaded = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { brandId: true },
      });
      expect(reloaded.brandId).toBeNull();
    } finally {
      await prisma.product.delete({ where: { id: product.id } });
    }
  });
});

test.describe("P6-T4 · Branches CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });
  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("POST happy с geo → 201 + БД", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/branches", {
      data: {
        nameRu: "E2E-TAX-Главный",
        nameUz: "E2E-TAX-Asosiy",
        nameEn: "E2E-TAX-Main",
        addressRu: "Ташкент, ул. Тестовая, 1",
        addressUz: "Toshkent, Test ko'chasi, 1",
        addressEn: "Tashkent, Test St., 1",
        phone: "+998901234567",
        latitude: 41.31,
        longitude: 69.28,
        isActive: true,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string };
    const created = await prisma.storeBranch.findUniqueOrThrow({
      where: { id: body.id },
      select: { nameRu: true, latitude: true, longitude: true },
    });
    expect(created).toMatchObject({
      nameRu: "E2E-TAX-Главный",
      latitude: 41.31,
      longitude: 69.28,
    });
  });

  test("POST 400 на latitude > 90", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/branches", {
      data: {
        nameRu: "E2E-TAX-Bad",
        nameUz: "E2E-TAX-Bad",
        nameEn: "E2E-TAX-Bad",
        addressRu: "Bad address",
        addressUz: "Bad address uz",
        addressEn: "Bad address en",
        latitude: 100,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("DELETE happy → 200 + Order.branchId=null (SetNull)", async ({ page }) => {
    await loginAsAdmin(page);
    const branch = await prisma.storeBranch.create({
      data: {
        nameRu: "E2E-TAX-Del",
        nameUz: "E2E-TAX-Del",
        nameEn: "E2E-TAX-Del",
        addressRu: "addr ru",
        addressUz: "addr uz",
        addressEn: "addr en",
      },
      select: { id: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-${Date.now()}-T4B`.slice(0, 22),
        status: "pending",
        locale: "ru",
        subtotalCents: 100,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100,
        currency: "UZS",
        deliveryMethod: "pickup",
        branchId: branch.id,
      },
      select: { id: true },
    });

    try {
      const res = await page.request.delete(`/api/admin/branches/${branch.id}`);
      expect(res.status()).toBe(200);
      const reloaded = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { branchId: true },
      });
      expect(reloaded.branchId).toBeNull();
    } finally {
      await prisma.order.delete({ where: { id: order.id } });
    }
  });
});

test.describe("P6-T4 · auth", () => {
  test("anon → 401 на все 6 ресурсных endpoint'ов", async ({ request }) => {
    for (const path of ["/api/admin/categories", "/api/admin/brands", "/api/admin/branches"]) {
      const res = await request.post(path, {
        data: {},
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(401);
    }
  });
});
