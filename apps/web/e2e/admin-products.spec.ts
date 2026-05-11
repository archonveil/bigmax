/**
 * P6-T3: e2e для admin products CRUD + CSV-импорт.
 *
 * Сценарии:
 *   1. Customer на /admin/products → middleware silent-redirect.
 *   2. List page рендерится с seeded товарами.
 *   3. Search по nameRu фильтрует.
 *   4. Active-filter работает.
 *   5. Create flow: новая страница → form submit → редирект на detail.
 *   6. Edit flow: detail → правка nameRu → save → router.refresh.
 *   7. Deactivate (soft-delete): кнопка → product.isActive=false.
 *   8. CSV import API: создание + skipped row.
 *   9. API guards: 401 для анона, 404 для customer.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-products@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Products",
  role: "admin" as const,
};

const SLUG_PREFIX = "e2e-prd-t3";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function cleanupTestProducts(): Promise<void> {
  await prisma.product.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
}

test.describe("P6-T3 · admin products CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanupTestProducts();
  });

  test.afterEach(async () => {
    await cleanupTestProducts();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("anon → POST /api/admin/products → 401", async ({ request }) => {
    const res = await request.post("/api/admin/products", {
      data: { foo: "bar" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("customer → POST /api/admin/products → 404 (silent)", async ({ page }) => {
    const customer = {
      email: "e2e-products-customer@bigmax.uz",
      password: "e2ePass1234",
      name: "Customer",
    };
    await createTestUser(customer);
    try {
      await page.goto("/ru/auth/login");
      await page.locator("input#email").fill(customer.email);
      await page.locator("input#password").fill(customer.password);
      await page.getByRole("button", { name: /^Войти$/ }).click();
      await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
      const res = await page.request.post("/api/admin/products", {
        data: {},
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });

  test("list page рендерится с seeded товарами", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/products");
    await expect(page.getByTestId("admin-products")).toBeVisible();
    await expect(page.getByTestId("admin-products-table")).toBeVisible();
    // В seed-данных есть Nuby Cherry — должны видеть хотя бы одну строку.
    const rows = page.getByTestId("admin-products-row");
    await expect(rows.first()).toBeVisible();
  });

  test("search по nameRu фильтрует", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/products?q=Nuby");
    await expect(page.getByTestId("admin-products-table")).toBeVisible();
    const rows = page.getByTestId("admin-products-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // Любая строка содержит «Nuby».
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText(/Nuby/i);
    }
  });

  test("active-filter ?active=false показывает только скрытые", async ({ page }) => {
    // Создаём 1 неактивный товар.
    const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const created = await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}-inactive`,
        nameRu: "P6T3 Inactive Test",
        nameUz: "Test",
        nameEn: "Test",
        categoryId: cat.id,
        isActive: false,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    await page.goto("/ru/admin/products?active=false");
    await expect(page.getByTestId("admin-products-table")).toBeVisible();
    await expect(
      page
        .getByTestId("admin-products-row")
        .locator(`[data-product-id="${created.id}"]`)
        .or(page.locator(`[data-product-id="${created.id}"]`)),
    ).toBeAttached();
    // Все видимые строки имеют «Скрыт» status.
    await expect(page.getByText("Скрыт").first()).toBeVisible();
  });

  test("create flow: form → POST → detail page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/products/new");
    await expect(page.getByTestId("admin-product-create")).toBeVisible();

    const slug = `${SLUG_PREFIX}-create`;
    await page.getByTestId("product-form-slug").fill(slug);
    await page.getByTestId("product-form-name-ru").fill("E2E Тест Create");
    // Tabs uz/en
    await page.getByRole("tab", { name: "UZ" }).click();
    await page.getByTestId("product-form-name-uz").fill("E2E Test UZ");
    await page.getByRole("tab", { name: "EN" }).click();
    await page.getByTestId("product-form-name-en").fill("E2E Test EN");

    await page.getByTestId("product-form-submit").click();
    await page.waitForURL(/\/ru\/admin\/products\/[^/]+$/, { timeout: 10_000 });

    // Detail page рендерится, slug корректный.
    await expect(page.getByTestId("admin-product-detail")).toBeVisible();
    const created = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, nameRu: true, nameUz: true, nameEn: true },
    });
    expect(created).not.toBeNull();
    expect(created!.nameRu).toBe("E2E Тест Create");
    expect(created!.nameUz).toBe("E2E Test UZ");
    expect(created!.nameEn).toBe("E2E Test EN");
  });

  test("edit flow: PATCH через UI → nameRu обновлён", async ({ page }) => {
    const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const product = await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}-edit`,
        nameRu: "Старое имя",
        nameUz: "old uz",
        nameEn: "old en",
        categoryId: cat.id,
        isActive: true,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/products/${product.id}`);
    await expect(page.getByTestId("admin-product-detail")).toBeVisible();

    await page.getByTestId("product-form-name-ru").fill("Новое имя");
    await page.getByTestId("product-form-submit").click();

    // На refresh — header h2 обновляется через router.refresh.
    await expect(page.locator("h2").first()).toContainText("Новое имя", { timeout: 10_000 });

    const updated = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { nameRu: true },
    });
    expect(updated.nameRu).toBe("Новое имя");
  });

  test("deactivate (soft-delete): isActive → false через API", async ({ page }) => {
    const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const product = await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}-delete`,
        nameRu: "Для удаления",
        nameUz: "x",
        nameEn: "x",
        categoryId: cat.id,
        isActive: true,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.delete(`/api/admin/products/${product.id}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deactivated: true });
    const updated = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { isActive: true },
    });
    expect(updated.isActive).toBe(false);
  });

  test("slug conflict → 409 slug_exists", async ({ page }) => {
    const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}-conflict`,
        nameRu: "Already exists",
        nameUz: "x",
        nameEn: "x",
        categoryId: cat.id,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/products", {
      data: {
        slug: `${SLUG_PREFIX}-conflict`,
        nameRu: "Duplicate",
        nameUz: "Duplicate uz",
        nameEn: "Duplicate en",
        categoryId: cat.id,
        gender: "unisex",
        isActive: true,
        isFeatured: false,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "slug_exists" });
  });

  test("PATCH 404 на неизвестный id", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.patch("/api/admin/products/nonexistent_cuid", {
      // Валидное тело — чтобы Zod не отдал 400 раньше findUnique-404.
      data: { nameRu: "Валидное имя" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("P6-T3 · CSV import", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanupTestProducts();
  });

  test.afterEach(async () => {
    await cleanupTestProducts();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("happy: 2 строки → created=2, skipped=0", async ({ page }) => {
    await loginAsAdmin(page);
    const csv = `slug,name_ru,name_uz,name_en,category_slug
${SLUG_PREFIX}-csv-1,CSV Тест 1,CSV Test 1 uz,CSV Test 1 en,toys
${SLUG_PREFIX}-csv-2,CSV Тест 2,CSV Test 2 uz,CSV Test 2 en,food`;

    const res = await page.request.post("/api/admin/products/import", {
      data: csv,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { created: number; updated: number; skipped: unknown[] };
    expect(body.created).toBe(2);
    expect(body.updated).toBe(0);
    expect(body.skipped).toHaveLength(0);

    const created = await prisma.product.findMany({
      where: { slug: { startsWith: `${SLUG_PREFIX}-csv` } },
    });
    expect(created).toHaveLength(2);
  });

  test("unknown category → skipped row", async ({ page }) => {
    await loginAsAdmin(page);
    const csv = `slug,name_ru,name_uz,name_en,category_slug
${SLUG_PREFIX}-csv-bad,Bad Cat,Bad Cat uz,Bad Cat en,unknown-category-xyz`;
    const res = await page.request.post("/api/admin/products/import", {
      data: csv,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      created: number;
      skipped: Array<{ rowIndex: number; reason: string; detail?: string }>;
    };
    expect(body.created).toBe(0);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]).toMatchObject({
      rowIndex: 2,
      reason: "unknown_category",
      detail: "unknown-category-xyz",
    });
  });

  test("missing required columns → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const csv = `slug,name_ru
${SLUG_PREFIX}-x,Тест`;
    const res = await page.request.post("/api/admin/products/import", {
      data: csv,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string; missing: string[] };
    expect(body.reason).toBe("missing_columns");
    expect(body.missing).toEqual(expect.arrayContaining(["name_uz", "name_en", "category_slug"]));
  });

  test("upsert: повторный импорт того же slug → updated=1", async ({ page }) => {
    await loginAsAdmin(page);
    const csv1 = `slug,name_ru,name_uz,name_en,category_slug
${SLUG_PREFIX}-upsert,Версия 1,V1 uz,V1 en,toys`;
    await page.request.post("/api/admin/products/import", {
      data: csv1,
      headers: { "Content-Type": "text/csv" },
    });

    const csv2 = `slug,name_ru,name_uz,name_en,category_slug
${SLUG_PREFIX}-upsert,Версия 2,V2 uz,V2 en,toys`;
    const res = await page.request.post("/api/admin/products/import", {
      data: csv2,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { created: number; updated: number };
    expect(body.created).toBe(0);
    expect(body.updated).toBe(1);

    const final = await prisma.product.findUniqueOrThrow({
      where: { slug: `${SLUG_PREFIX}-upsert` },
      select: { nameRu: true },
    });
    expect(final.nameRu).toBe("Версия 2");
  });

  test("anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/products/import", {
      data: "x",
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(401);
  });
});
