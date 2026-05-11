/**
 * P6-T5: e2e для admin orders — list/filter, status-change, PDF-invoice.
 *
 * Сценарии:
 *   1. Anon на API → 401, customer → 404 (silent — admin-API guard).
 *   2. List page рендерится с seeded заказом.
 *   3. Search по `Order.number` фильтрует.
 *   4. Filter по status=confirmed работает.
 *   5. Detail page открывается + статус-changer показывает только разрешённые
 *      переходы (state-machine).
 *   6. Status change: `pending → confirmed` через API → PaymentLog запись.
 *   7. Illegal transition `pending → delivered` → 400.
 *   8. Status unchanged → 409.
 *   9. PDF invoice: `Content-Type: application/pdf` + non-empty body.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-orders@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Orders",
  role: "admin" as const,
};

const PREFIX = "BGX-T5E2E";

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const seq = String(((Date.now() | 0) + seedCounter) % 999_999).padStart(6, "0");
  return `${PREFIX}-${seq}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function seedOrder(input: {
  status: "pending" | "confirmed" | "delivered";
  totalCents?: number;
  email: string;
}): Promise<{ id: string; number: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true },
  });
  // Используем любой seed-variant — content-snapshot всё равно идёт через
  // productSnapshot JSON.
  const variant = await prisma.productVariant.findFirstOrThrow({
    select: { id: true, sku: true, priceCents: true, product: { select: { nameRu: true } } },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number: nextOrderNumber(),
      status: input.status,
      locale: "ru",
      subtotalCents: input.totalCents ?? 100_000_00,
      deliveryCostCents: 25_000_00,
      discountCents: 0,
      totalCents: (input.totalCents ?? 100_000_00) + 25_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: 2,
            priceCents: 50_000_00,
            productSnapshot: {
              sku: variant.sku,
              color: "blue",
              product: { slug: "p-t5", nameRu: variant.product.nameRu },
            },
          },
        ],
      },
    },
    select: { id: true, number: true },
  });
  return order;
}

async function cleanup(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { number: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) return;
  // PaymentLog для status_change-записей пишется с paymentId=null и orderId
  // в request JSON — чистим через JSONB-поиск, чтобы не оставлять мусора.
  for (const id of ids) {
    await prisma.paymentLog
      .deleteMany({
        where: {
          action: "order.status_change",
          request: { path: ["orderId"], equals: id },
        },
      })
      .catch(() => {});
  }
  const paymentIds = (
    await prisma.payment.findMany({ where: { orderId: { in: ids } }, select: { id: true } })
  ).map((p) => p.id);
  if (paymentIds.length > 0) {
    await prisma.paymentLog.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

test.describe("P6-T5 · admin orders", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("anon → POST /api/admin/orders/x/status → 401", async ({ request }) => {
    const res = await request.post("/api/admin/orders/some_id/status", {
      data: { status: "confirmed" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("customer → POST /api/admin/orders/x/status → 404 (silent)", async ({ page }) => {
    const customer = {
      email: "e2e-orders-customer@bigmax.uz",
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
      const res = await page.request.post("/api/admin/orders/some_id/status", {
        data: { status: "confirmed" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });

  test("list page → видна seeded запись + filter по номеру", async ({ page }) => {
    const order = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    await page.goto("/ru/admin/orders");
    await expect(page.getByTestId("admin-orders")).toBeVisible();
    const row = page.locator(`tr[data-order-id="${order.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(order.number);

    // Search по полному номеру.
    await page.getByTestId("admin-orders-search-input").fill(order.number);
    await page.keyboard.press("Enter");
    await expect(page.locator(`tr[data-order-id="${order.id}"]`)).toBeVisible();
  });

  test("filter status=confirmed скрывает pending-заказы", async ({ page }) => {
    const pendingOrder = await seedOrder({ status: "pending", email: ADMIN.email });
    const confirmedOrder = await seedOrder({ status: "confirmed", email: ADMIN.email });

    await loginAsAdmin(page);
    await page.goto("/ru/admin/orders?status=confirmed");
    await expect(page.locator(`tr[data-order-id="${confirmedOrder.id}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-order-id="${pendingOrder.id}"]`)).toHaveCount(0);
  });

  test("detail → допустимые переходы из pending = [confirmed, cancelled]", async ({ page }) => {
    const order = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    await page.goto(`/ru/admin/orders/${order.id}`);
    await expect(page.getByTestId("admin-order-detail")).toBeVisible();
    await expect(page.getByTestId("order-status-target-confirmed")).toBeVisible();
    await expect(page.getByTestId("order-status-target-cancelled")).toBeVisible();
    // Но не shipped и не delivered.
    await expect(page.getByTestId("order-status-target-shipped")).toHaveCount(0);
    await expect(page.getByTestId("order-status-target-delivered")).toHaveCount(0);
  });

  test("status change: pending → confirmed → 200 + БД updated + PaymentLog", async ({ page }) => {
    const order = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "confirmed", reason: "Платёж подтверждён вручную" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("confirmed");

    const reloaded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(reloaded.status).toBe("confirmed");

    // PaymentLog запись `order.status_change` должна существовать.
    const logs = await prisma.paymentLog.findMany({
      where: { action: "order.status_change" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const ours = logs.find((l) => {
      const req = l.request as { orderId?: string } | null;
      return req?.orderId === order.id;
    });
    expect(ours).toBeDefined();
  });

  test("illegal transition pending → delivered → 400", async ({ page }) => {
    const order = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "delivered" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("illegal_transition");

    const reloaded = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(reloaded.status).toBe("pending");
  });

  test("status_unchanged → 409", async ({ page }) => {
    const order = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/orders/${order.id}/status`, {
      data: { status: "pending" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("status_unchanged");
  });

  test("invoice.pdf → application/pdf + non-empty", async ({ page }) => {
    const order = await seedOrder({ status: "confirmed", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.get(`/api/admin/orders/${order.id}/invoice.pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const buf = await res.body();
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic bytes: %PDF
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  test("invoice.pdf для несуществующего id → 404", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.get("/api/admin/orders/cuid_doesnt_exist/invoice.pdf");
    expect(res.status()).toBe(404);
  });
});
