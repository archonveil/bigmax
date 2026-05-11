/**
 * P6-T3 follow-up: e2e для variant CRUD endpoint'ов.
 *
 * UI flow (dialog → form → save) покрыт smoke'ом через 1 сценарий, остальное
 * через прямые API-вызовы для скорости.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-variants@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Variants",
  role: "admin" as const,
};

const SLUG = "e2e-prd-variants-host";
const SKU_PREFIX = "E2E-VAR-T3F-";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function seedHostProduct(): Promise<{ id: string }> {
  const cat = await prisma.category.findFirstOrThrow({ select: { id: true } });
  return await prisma.product.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      nameRu: "Variants host",
      nameUz: "Variants host",
      nameEn: "Variants host",
      categoryId: cat.id,
    },
    select: { id: true },
  });
}

async function cleanup(): Promise<void> {
  // delete variants → product (cascade на variant'ы тоже сработает, но
  // сначала чистим тестовые SKU явно для предсказуемости).
  await prisma.productVariant.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
  await prisma.product.deleteMany({ where: { slug: SLUG } });
}

test.describe("P6-T3 follow-up · admin variants CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("POST happy: 201 + variant в БД", async ({ page }) => {
    const product = await seedHostProduct();
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/products/${product.id}/variants`, {
      data: {
        sku: `${SKU_PREFIX}001`,
        color: "pink",
        size: "0-6m",
        priceCents: 50_000_00,
        oldPriceCents: 60_000_00,
        weightGrams: 50,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string; sku: string };
    expect(body.sku).toBe(`${SKU_PREFIX}001`);

    const created = await prisma.productVariant.findUnique({
      where: { id: body.id },
      select: { sku: true, color: true, priceCents: true, oldPriceCents: true },
    });
    expect(created).toMatchObject({
      sku: `${SKU_PREFIX}001`,
      color: "pink",
      priceCents: 50_000_00,
      oldPriceCents: 60_000_00,
    });
  });

  test("POST 404 на неизвестный productId", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/products/cuid_nonexistent/variants", {
      data: { sku: `${SKU_PREFIX}404`, priceCents: 100 },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("POST 409 sku_exists на дубликат", async ({ page }) => {
    const product = await seedHostProduct();
    await loginAsAdmin(page);
    await page.request.post(`/api/admin/products/${product.id}/variants`, {
      data: { sku: `${SKU_PREFIX}DUP`, priceCents: 100 },
      headers: { "Content-Type": "application/json" },
    });
    const res = await page.request.post(`/api/admin/products/${product.id}/variants`, {
      data: { sku: `${SKU_PREFIX}DUP`, priceCents: 200 },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "sku_exists" });
  });

  test("POST 400 на невалидную цену (oldPrice < price)", async ({ page }) => {
    const product = await seedHostProduct();
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/products/${product.id}/variants`, {
      data: {
        sku: `${SKU_PREFIX}BADPRICE`,
        priceCents: 200,
        oldPriceCents: 100,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({
      ok: false,
      reason: "invalid_body",
      message: "old_price_must_exceed_price",
    });
  });

  test("PATCH happy: priceCents обновлён", async ({ page }) => {
    const product = await seedHostProduct();
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${SKU_PREFIX}EDIT`,
        priceCents: 100,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.patch(
      `/api/admin/products/${product.id}/variants/${variant.id}`,
      {
        data: { priceCents: 200, color: "blue" },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(200);
    const updated = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { priceCents: true, color: true },
    });
    expect(updated.priceCents).toBe(200);
    expect(updated.color).toBe("blue");
  });

  test("PATCH 404 на чужой variant (другой productId)", async ({ page }) => {
    const product = await seedHostProduct();
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${SKU_PREFIX}OWNERTEST`, priceCents: 100 },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.patch(
      `/api/admin/products/cuid_other_product/variants/${variant.id}`,
      {
        data: { priceCents: 200 },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(404);
  });

  test("DELETE happy на свободный variant", async ({ page }) => {
    const product = await seedHostProduct();
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${SKU_PREFIX}DEL`, priceCents: 100 },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.delete(
      `/api/admin/products/${product.id}/variants/${variant.id}`,
    );
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: true });
    const stillThere = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(stillThere).toBeNull();
  });

  test("DELETE 409 variant_in_use если variant в любом OrderItem", async ({ page }) => {
    const product = await seedHostProduct();
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${SKU_PREFIX}INUSE`, priceCents: 100 },
      select: { id: true },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-${Date.now()}-V3F`.slice(0, 22),
        status: "pending",
        locale: "ru",
        subtotalCents: 100,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100,
        currency: "UZS",
        deliveryMethod: "courier",
        items: {
          create: [
            {
              variantId: variant.id,
              quantity: 1,
              priceCents: 100,
              productSnapshot: { sku: `${SKU_PREFIX}INUSE` },
            },
          ],
        },
      },
      select: { id: true },
    });

    try {
      await loginAsAdmin(page);
      const res = await page.request.delete(
        `/api/admin/products/${product.id}/variants/${variant.id}`,
      );
      expect(res.status()).toBe(409);
      const body = (await res.json()) as { reason: string; ordersCount: number };
      expect(body.reason).toBe("variant_in_use");
      expect(body.ordersCount).toBe(1);
    } finally {
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    }
  });

  test("UI smoke: open dialog → fill → submit → variant в таблице", async ({ page }) => {
    const product = await seedHostProduct();
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/products/${product.id}`);
    await expect(page.getByTestId("variants-manager")).toBeVisible();
    // Empty state визуально присутствует (пока вариантов нет).
    await expect(page.getByTestId("variants-empty")).toBeVisible();

    await page.getByTestId("variant-add-button").click();
    await expect(page.getByTestId("variant-dialog")).toBeVisible();

    const sku = `${SKU_PREFIX}UI001`;
    await page.getByTestId("variant-form-sku").fill(sku);
    await page.getByTestId("variant-form-color").fill("red");
    await page.getByTestId("variant-form-price").fill("12345600");
    await page.getByTestId("variant-form-submit").click();

    // После refresh dialog исчезает + таблица содержит новый variant.
    await expect(page.getByTestId("variants-table")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("variants-table")).toContainText(sku);

    const created = await prisma.productVariant.findUnique({
      where: { sku },
      select: { sku: true, color: true, priceCents: true },
    });
    expect(created).toMatchObject({ sku, color: "red", priceCents: 12345600 });
  });

  test("anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/products/anything/variants", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
