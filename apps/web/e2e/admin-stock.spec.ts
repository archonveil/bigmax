/**
 * P6-T7: e2e для admin stock — list/filter/adjust/delete/import + auth.
 *
 * Использует реальные seed-data (variants + branches существуют). Каждый
 * тест seed-ит свой Stock-row через Prisma (не через API), чтобы tests не
 * зависели друг от друга и cleanup был чистый.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-stock@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Stock",
  role: "admin" as const,
};

const SKU_PREFIX = "T7-E2E-";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function getOrCreateBranch(): Promise<string> {
  const existing = await prisma.storeBranch.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  return existing!.id;
}

async function getOrCreateVariant(suffix: string): Promise<string> {
  const sku = `${SKU_PREFIX}${suffix}`;
  const existing = await prisma.productVariant.findUnique({
    where: { sku },
    select: { id: true },
  });
  if (existing) return existing.id;
  // Создаём временный product + variant.
  const product = await prisma.product.findFirstOrThrow({ select: { id: true } });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku,
      priceCents: 100_000_00,
    },
    select: { id: true },
  });
  return variant.id;
}

async function seedStock(input: {
  variantId: string;
  branchId: string;
  quantity: number;
  reserved?: number;
}): Promise<{ id: string }> {
  return prisma.stock.upsert({
    where: { variantId_branchId: { variantId: input.variantId, branchId: input.branchId } },
    update: { quantity: input.quantity, reserved: input.reserved ?? 0 },
    create: { ...input, reserved: input.reserved ?? 0 },
    select: { id: true },
  });
}

async function cleanup(): Promise<void> {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { startsWith: SKU_PREFIX } },
    select: { id: true },
  });
  const variantIds = variants.map((v) => v.id);
  if (variantIds.length === 0) return;
  await prisma.stockLog.deleteMany({ where: { variantId: { in: variantIds } } });
  await prisma.stock.deleteMany({ where: { variantId: { in: variantIds } } });
  await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
}

test.describe("P6-T7 · admin stock CRUD", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("anon → POST /api/admin/stock/x/adjust → 401", async ({ request }) => {
    const res = await request.post("/api/admin/stock/some_id/adjust", {
      data: { mode: "set", value: 10, reason: "test ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("customer → POST /api/admin/stock/x/adjust → 404 (silent)", async ({ page }) => {
    const customer = {
      email: "e2e-stock-customer@bigmax.uz",
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
      const res = await page.request.post("/api/admin/stock/some_id/adjust", {
        data: { mode: "set", value: 10, reason: "test ok" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });

  test("list page → видит seeded stock + filter по branch", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("V1");
    const stock = await seedStock({ variantId, branchId, quantity: 30 });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/stock?branchId=${branchId}`);
    await expect(page.getByTestId("admin-stock")).toBeVisible();
    await expect(page.locator(`tr[data-stock-id="${stock.id}"]`)).toBeVisible();
  });

  test("lowStock filter → показывает только low (≤ 5)", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const lowVar = await getOrCreateVariant("LOW");
    const okVar = await getOrCreateVariant("OK");
    const lowStock = await seedStock({ variantId: lowVar, branchId, quantity: 2 });
    const okStock = await seedStock({ variantId: okVar, branchId, quantity: 50 });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/stock?branchId=${branchId}&lowStock=true`);
    await expect(page.locator(`tr[data-stock-id="${lowStock.id}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-stock-id="${okStock.id}"]`)).toHaveCount(0);
  });

  test("POST /api/admin/stock upsert: новая запись + StockLog", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("UPS");

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/stock", {
      data: { variantId, branchId, quantity: 50, reason: "Initial setup" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; created: boolean; quantity: number };
    expect(body.created).toBe(true);
    expect(body.quantity).toBe(50);

    const stock = await prisma.stock.findUniqueOrThrow({
      where: { variantId_branchId: { variantId, branchId } },
      select: { quantity: true },
    });
    expect(stock.quantity).toBe(50);

    const log = await prisma.stockLog.findFirst({
      where: { variantId, branchId, action: "create" },
      select: { oldQty: true, newQty: true, delta: true },
    });
    expect(log?.oldQty).toBe(0);
    expect(log?.newQty).toBe(50);
    expect(log?.delta).toBe(50);
  });

  test("POST adjust set: 10 → 25 + StockLog", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("ADJ");
    const stock = await seedStock({ variantId, branchId, quantity: 10 });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/stock/${stock.id}/adjust`, {
      data: { mode: "set", value: 25, reason: "Inventory recount Q2" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { oldQty: number; newQty: number; delta: number };
    expect(body.oldQty).toBe(10);
    expect(body.newQty).toBe(25);
    expect(body.delta).toBe(15);

    const log = await prisma.stockLog.findFirst({
      where: { stockId: stock.id, action: "set" },
      select: { reason: true },
    });
    expect(log?.reason).toBe("Inventory recount Q2");
  });

  test("POST adjust dec: clamp на 0 при value > current", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("CLAMP");
    const stock = await seedStock({ variantId, branchId, quantity: 5 });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/stock/${stock.id}/adjust`, {
      data: { mode: "dec", value: 100, reason: "Списано всё" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { newQty: number };
    expect(body.newQty).toBe(0);
  });

  test("POST adjust no-op (set к текущему qty) → noop=true, без StockLog", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("NOOP");
    const stock = await seedStock({ variantId, branchId, quantity: 50 });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/stock/${stock.id}/adjust`, {
      data: { mode: "set", value: 50, reason: "Sanity-check" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { noop?: boolean };
    expect(body.noop).toBe(true);

    const logCount = await prisma.stockLog.count({ where: { stockId: stock.id } });
    expect(logCount).toBe(0);
  });

  test("DELETE /api/admin/stock/[id] → ok + StockLog action='delete'", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("DEL");
    const stock = await seedStock({ variantId, branchId, quantity: 12 });

    await loginAsAdmin(page);
    const res = await page.request.delete(`/api/admin/stock/${stock.id}`);
    expect(res.status()).toBe(200);

    const reloaded = await prisma.stock.findUnique({ where: { id: stock.id } });
    expect(reloaded).toBeNull();

    // StockLog с action="delete" сохранился (FK SetNull).
    const log = await prisma.stockLog.findFirst({
      where: { variantId, branchId, action: "delete" },
      select: { oldQty: true, newQty: true, delta: true },
    });
    expect(log?.oldQty).toBe(12);
    expect(log?.newQty).toBe(0);
    expect(log?.delta).toBe(-12);
  });

  test("DELETE с reserved > 0 → 409 has_reserved", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("RSV");
    const stock = await seedStock({ variantId, branchId, quantity: 10, reserved: 3 });

    await loginAsAdmin(page);
    const res = await page.request.delete(`/api/admin/stock/${stock.id}`);
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string; reserved: number };
    expect(body.reason).toBe("has_reserved");
    expect(body.reserved).toBe(3);
  });

  test("CSV import: 2 валидных строки + 1 unknown SKU → processed=2 + skipped=1", async ({
    page,
  }) => {
    const branchId = await getOrCreateBranch();
    const v1 = await getOrCreateVariant("CSV1");
    const v2 = await getOrCreateVariant("CSV2");
    void v1;
    void v2;

    await loginAsAdmin(page);
    const csv = `sku,branch_id,quantity
${SKU_PREFIX}CSV1,${branchId},25
${SKU_PREFIX}CSV2,${branchId},40
${SKU_PREFIX}UNKNOWN,${branchId},10`;
    const res = await page.request.post("/api/admin/stock/import", {
      data: csv,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      skipped: Array<{ sku: string; reason: string }>;
    };
    expect(body.processed).toBe(2);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.reason).toBe("variant_not_found");

    // БД: оба валидных variant'а с заданными quantity.
    const stocks = await prisma.stock.findMany({
      where: { variant: { sku: { startsWith: SKU_PREFIX } } },
      select: { variant: { select: { sku: true } }, quantity: true },
    });
    const map = new Map(stocks.map((s) => [s.variant.sku, s.quantity]));
    expect(map.get(`${SKU_PREFIX}CSV1`)).toBe(25);
    expect(map.get(`${SKU_PREFIX}CSV2`)).toBe(40);
  });

  test("CSV import: missing_columns → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/stock/import", {
      data: "sku,quantity\nNB-1,10",
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("missing_columns");
  });

  test("CSV import anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/stock/import", {
      data: "sku,branch_id,quantity\nNB-1,br,10",
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(401);
  });

  test("UI smoke: adjust-dialog → submit → row updated", async ({ page }) => {
    const branchId = await getOrCreateBranch();
    const variantId = await getOrCreateVariant("UI1");
    const stock = await seedStock({ variantId, branchId, quantity: 7 });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/stock?branchId=${branchId}&q=${SKU_PREFIX}UI1`);
    const row = page.locator(`tr[data-stock-id="${stock.id}"]`);
    await expect(row).toBeVisible();
    await row.getByTestId("stock-adjust-trigger").click();
    await expect(page.getByTestId("stock-adjust-form")).toBeVisible();
    // Default mode=set, value=current=7 → меняем на 99.
    await page.getByTestId("stock-adjust-value").fill("99");
    await page.getByTestId("stock-adjust-reason").fill("UI smoke test");
    await page.getByTestId("stock-adjust-submit").click();

    // Дожидаемся router.refresh — row перерисуется с новой available.
    await expect(
      page.locator(`tr[data-stock-id="${stock.id}"] [data-testid="admin-stock-available"]`),
    ).toContainText("99", { timeout: 10_000 });
  });
});
