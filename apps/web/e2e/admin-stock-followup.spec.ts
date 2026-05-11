/**
 * P6-T7 follow-up: e2e для закрытых open question'ов:
 *   (a) StoreBranch.slug + CSV import lookup by slug
 *   (b) Bulk-adjust по SKU-pattern
 *   (c) Stock history page /admin/stock/[id]/history
 *   (d) Order shipment audit через P6-T5 status-change → StockLog
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-stock-fu@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Stock FU",
  role: "admin" as const,
};

const SKU_PREFIX = "T7FU-";
const BRANCH_SLUG = "e2e-stock-fu-branch";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function getOrCreateVariant(suffix: string): Promise<string> {
  const sku = `${SKU_PREFIX}${suffix}`;
  const existing = await prisma.productVariant.findUnique({
    where: { sku },
    select: { id: true },
  });
  if (existing) return existing.id;
  const product = await prisma.product.findFirstOrThrow({ select: { id: true } });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku, priceCents: 100_000_00 },
    select: { id: true },
  });
  return variant.id;
}

async function getOrCreateBranchWithSlug(): Promise<string> {
  const existing = await prisma.storeBranch.findUnique({
    where: { slug: BRANCH_SLUG },
    select: { id: true },
  });
  if (existing) return existing.id;
  const branch = await prisma.storeBranch.create({
    data: {
      slug: BRANCH_SLUG,
      nameRu: "E2E Test Branch FU",
      nameUz: "E2E Test Branch FU",
      nameEn: "E2E Test Branch FU",
      addressRu: "Тест-адрес 1",
      addressUz: "Test manzil 1",
      addressEn: "Test addr 1",
      isActive: true,
    },
    select: { id: true },
  });
  return branch.id;
}

async function cleanup(): Promise<void> {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { startsWith: SKU_PREFIX } },
    select: { id: true },
  });
  const variantIds = variants.map((v) => v.id);
  const branch = await prisma.storeBranch.findUnique({
    where: { slug: BRANCH_SLUG },
    select: { id: true },
  });

  if (variantIds.length > 0) {
    await prisma.stockLog.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.stock.deleteMany({ where: { variantId: { in: variantIds } } });
    // Удалим заказы (если были созданы для shipment-теста).
    const orders = await prisma.order.findMany({
      where: {
        items: { some: { variantId: { in: variantIds } } },
      },
      select: { id: true },
    });
    if (orders.length > 0) {
      const orderIds = orders.map((o) => o.id);
      await prisma.paymentLog
        .deleteMany({
          where: {
            OR: [
              { request: { path: ["orderId"], in: orderIds } as never },
              { payment: { orderId: { in: orderIds } } },
            ],
          },
        })
        .catch(() => {});
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
  }
  if (branch) {
    await prisma.stockLog.deleteMany({ where: { branchId: branch.id } });
    await prisma.storeBranch.delete({ where: { id: branch.id } }).catch(() => {});
  }
}

test.describe("P6-T7 follow-up · slug + bulk + history + shipment audit", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("(a) StoreBranch.slug → CSV import находит branch по slug", async ({ page }) => {
    await getOrCreateBranchWithSlug();
    const v1 = await getOrCreateVariant("SLUG1");
    void v1;
    await loginAsAdmin(page);
    const csv = `sku,branch_slug,quantity\n${SKU_PREFIX}SLUG1,${BRANCH_SLUG},42`;
    const res = await page.request.post("/api/admin/stock/import", {
      data: csv,
      headers: { "Content-Type": "text/csv" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { processed: number; skipped: unknown[] };
    expect(body.processed).toBe(1);
    expect(body.skipped).toHaveLength(0);

    const stock = await prisma.stock.findFirstOrThrow({
      where: { variant: { sku: `${SKU_PREFIX}SLUG1` } },
      select: { quantity: true },
    });
    expect(stock.quantity).toBe(42);
  });

  test("(a) PATCH /api/admin/branches/[id] обновляет slug", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    await loginAsAdmin(page);
    const newSlug = "e2e-stock-fu-renamed";
    const res = await page.request.patch(`/api/admin/branches/${branchId}`, {
      data: { slug: newSlug },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    const reloaded = await prisma.storeBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { slug: true },
    });
    expect(reloaded.slug).toBe(newSlug);
  });

  test("(b) Bulk-adjust SKU-pattern: NB-* → set 100", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const v1 = await getOrCreateVariant("BULK-A");
    const v2 = await getOrCreateVariant("BULK-B");
    const v3 = await getOrCreateVariant("OTHER-C");
    await prisma.stock.createMany({
      data: [
        { variantId: v1, branchId, quantity: 10 },
        { variantId: v2, branchId, quantity: 10 },
        { variantId: v3, branchId, quantity: 10 },
      ],
    });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/stock/bulk-adjust", {
      data: {
        branchId,
        skuPattern: `${SKU_PREFIX}BULK-*`,
        mode: "set",
        value: 100,
        reason: "Bulk recount",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { processed: number; matched: number };
    expect(body.matched).toBe(2);
    expect(body.processed).toBe(2);

    const reloaded = await prisma.stock.findMany({
      where: { variantId: { in: [v1, v2, v3] } },
      orderBy: { variant: { sku: "asc" } },
      select: { quantity: true, variant: { select: { sku: true } } },
    });
    expect(reloaded.find((r) => r.variant.sku.endsWith("BULK-A"))?.quantity).toBe(100);
    expect(reloaded.find((r) => r.variant.sku.endsWith("BULK-B"))?.quantity).toBe(100);
    // OTHER-C не задет.
    expect(reloaded.find((r) => r.variant.sku.endsWith("OTHER-C"))?.quantity).toBe(10);

    // StockLog audit-rows с reason="bulk: ..."
    const logs = await prisma.stockLog.findMany({
      where: { branchId, action: "set", reason: { contains: "bulk:" } },
      select: { variantId: true },
    });
    expect(logs).toHaveLength(2);
  });

  test("(b) Bulk-adjust pattern с no-match → matched=0 + processed=0", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/stock/bulk-adjust", {
      data: {
        branchId,
        skuPattern: "NONEXISTENT-PREFIX-*",
        mode: "set",
        value: 50,
        reason: "Empty pattern",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { matched: number; processed: number };
    expect(body.matched).toBe(0);
    expect(body.processed).toBe(0);
  });

  test("(b) Bulk-adjust anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/stock/bulk-adjust", {
      data: { branchId: "br", skuPattern: "*", mode: "set", value: 1, reason: "ok ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("(c) Stock history page показывает StockLog запись после adjust'а", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("HIST");
    const stock = await prisma.stock.create({
      data: { variantId, branchId, quantity: 10 },
      select: { id: true },
    });

    await loginAsAdmin(page);
    // Сделаем adjust → запись в StockLog.
    const res = await page.request.post(`/api/admin/stock/${stock.id}/adjust`, {
      data: { mode: "inc", value: 15, reason: "Поступление товара" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    await page.goto(`/ru/admin/stock/${stock.id}/history`);
    await expect(page.getByTestId("admin-stock-history")).toBeVisible();
    await expect(page.getByTestId("admin-stock-history-table")).toBeVisible();
    const row = page.getByTestId("admin-stock-history-row").first();
    await expect(row).toHaveAttribute("data-action", "inc");
    await expect(row).toContainText("Поступление товара");
    await expect(row).toContainText(/\+15|10|25/);
  });

  test("(c) History pagination для 60+ записей → 2 страницы по 50", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("PAG");
    const stock = await prisma.stock.create({
      data: { variantId, branchId, quantity: 100 },
      select: { id: true },
    });

    // Seed 55 audit-rows напрямую.
    const seed: Array<{
      stockId: string;
      variantId: string;
      branchId: string;
      action: string;
      oldQty: number;
      newQty: number;
      delta: number;
      reason: string;
    }> = [];
    for (let i = 0; i < 55; i += 1) {
      seed.push({
        stockId: stock.id,
        variantId,
        branchId,
        action: "set",
        oldQty: 100,
        newQty: 100,
        delta: 0,
        reason: `seed ${i}`,
      });
    }
    await prisma.stockLog.createMany({ data: seed });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/stock/${stock.id}/history`);
    const rows = page.getByTestId("admin-stock-history-row");
    await expect(rows).toHaveCount(50);
    await expect(page.getByTestId("admin-stock-history-pagination")).toBeVisible();

    await page.goto(`/ru/admin/stock/${stock.id}/history?page=2`);
    const rows2 = page.getByTestId("admin-stock-history-row");
    await expect(rows2).toHaveCount(5);
  });

  test("(d) Order → shipped → StockLog action='ship' + Stock.quantity decremented", async ({
    page,
  }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("SHIP");
    await prisma.stock.create({
      data: { variantId, branchId, quantity: 50 },
    });

    // Seed pickup-order в статусе packing с этим variant'ом.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-T7FU-${Date.now() % 999999}`,
        status: "packing",
        locale: "ru",
        subtotalCents: 100_000_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_000_00,
        currency: "UZS",
        deliveryMethod: "pickup",
        branchId,
        items: {
          create: [
            {
              variantId,
              quantity: 3,
              priceCents: 100_000_00,
              productSnapshot: { sku: `${SKU_PREFIX}SHIP` },
            },
          ],
        },
      },
      select: { id: true, number: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "shipped", reason: "Отправлено курьером" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    // Stock.quantity должен уменьшиться на 3.
    const reloaded = await prisma.stock.findFirstOrThrow({
      where: { variantId, branchId },
      select: { quantity: true },
    });
    expect(reloaded.quantity).toBe(47);

    // StockLog `action: "ship"` запись.
    const log = await prisma.stockLog.findFirstOrThrow({
      where: { variantId, branchId, action: "ship" },
      select: { oldQty: true, newQty: true, delta: true, reason: true },
    });
    expect(log.oldQty).toBe(50);
    expect(log.newQty).toBe(47);
    expect(log.delta).toBe(-3);
    expect(log.reason).toContain(order.number);
  });

  test("(d) Shipped без Stock-row → skipped (best-effort, status flip всё равно)", async ({
    page,
  }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("NO-STOCK");
    // НЕ создаём Stock.

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-T7FU-NS-${Date.now() % 999999}`,
        status: "packing",
        locale: "ru",
        subtotalCents: 100_000_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_000_00,
        currency: "UZS",
        deliveryMethod: "pickup",
        branchId,
        items: {
          create: [
            {
              variantId,
              quantity: 1,
              priceCents: 100_000_00,
              productSnapshot: { sku: `${SKU_PREFIX}NO-STOCK` },
            },
          ],
        },
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "shipped" },
      headers: { "Content-Type": "application/json" },
    });
    // Status flip всё равно прошёл, no_stock_row попал в skipped[].
    expect(res.status()).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(reloaded.status).toBe("shipped");

    // StockLog `action: "ship"` НЕ создан (no Stock row).
    const log = await prisma.stockLog.findFirst({
      where: { variantId, branchId, action: "ship" },
    });
    expect(log).toBeNull();
  });

  test("(d-полное) shipped: одной транзакцией обновляются И quantity И reserved", async ({
    page,
  }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("FULL-SHIP");
    // Pre-seed: quantity=50, reserved=3 (как будто заказ уже зарезервирован).
    await prisma.stock.create({
      data: { variantId, branchId, quantity: 50, reserved: 3 },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-T7FU-FSH-${Date.now() % 999999}`,
        status: "packing",
        locale: "ru",
        subtotalCents: 100_000_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_000_00,
        currency: "UZS",
        deliveryMethod: "pickup",
        branchId,
        items: {
          create: [
            {
              variantId,
              quantity: 3,
              priceCents: 100_000_00,
              productSnapshot: { sku: `${SKU_PREFIX}FULL-SHIP` },
            },
          ],
        },
      },
      select: { id: true, number: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "shipped" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    const reloaded = await prisma.stock.findFirstOrThrow({
      where: { variantId, branchId },
      select: { quantity: true, reserved: true },
    });
    expect(reloaded.quantity).toBe(47); // 50 - 3
    expect(reloaded.reserved).toBe(0); // 3 - 3

    const log = await prisma.stockLog.findFirstOrThrow({
      where: { variantId, branchId, action: "ship" },
      select: { delta: true, reservedDelta: true, oldReserved: true, newReserved: true },
    });
    expect(log.delta).toBe(-3);
    expect(log.reservedDelta).toBe(-3);
    expect(log.oldReserved).toBe(3);
    expect(log.newReserved).toBe(0);
  });

  test("(d-полное) admin cancelled → release reserved (qty не трогается)", async ({ page }) => {
    const branchId = await getOrCreateBranchWithSlug();
    const variantId = await getOrCreateVariant("RELEASE");
    await prisma.stock.create({
      data: { variantId, branchId, quantity: 50, reserved: 5 },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: `BGX-T7FU-REL-${Date.now() % 999999}`,
        status: "pending",
        locale: "ru",
        subtotalCents: 100_000_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_000_00,
        currency: "UZS",
        deliveryMethod: "pickup",
        branchId,
        items: {
          create: [
            {
              variantId,
              quantity: 2,
              priceCents: 100_000_00,
              productSnapshot: { sku: `${SKU_PREFIX}RELEASE` },
            },
          ],
        },
      },
      select: { id: true, number: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "cancelled", reason: "Клиент передумал" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    const reloaded = await prisma.stock.findFirstOrThrow({
      where: { variantId, branchId },
      select: { quantity: true, reserved: true },
    });
    expect(reloaded.quantity).toBe(50); // не трогается
    expect(reloaded.reserved).toBe(3); // 5 - 2

    const log = await prisma.stockLog.findFirstOrThrow({
      where: { variantId, branchId, action: "release" },
      select: { delta: true, reservedDelta: true, reason: true },
    });
    expect(log.delta).toBe(0);
    expect(log.reservedDelta).toBe(-2);
    expect(log.reason).toContain(order.number);
  });
});
