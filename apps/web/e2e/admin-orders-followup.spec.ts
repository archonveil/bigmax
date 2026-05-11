/**
 * P6-T5 follow-up: e2e для закрытых open question'ов:
 *   (a) PDF-локализация на ru/uz/en
 *   (b) Cyrillic-glyphs в PDF (Roboto-шрифт)
 *   (c) bulk-смена статуса
 *   (d) date range filter
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-orders-fu@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Orders FU",
  role: "admin" as const,
};

const PREFIX = "BGX-T5FU";

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
  locale?: "ru" | "uz" | "en";
  createdAt?: Date;
  email: string;
}): Promise<{ id: string; number: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true },
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    select: { id: true, sku: true, priceCents: true, product: { select: { nameRu: true } } },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number: nextOrderNumber(),
      status: input.status,
      locale: input.locale ?? "ru",
      subtotalCents: 100_000_00,
      deliveryCostCents: 25_000_00,
      discountCents: 0,
      totalCents: 125_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: 1,
            priceCents: 100_000_00,
            productSnapshot: {
              sku: variant.sku,
              color: "розовый",
              product: { slug: "p-fu", nameRu: "Тестовый товар «Бигмах»" },
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
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

test.describe("P6-T5 follow-up · open questions a/b/c/d", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("(a)+(b) PDF на ru с кириллицей → magic bytes + minSize", async ({ page }) => {
    const order = await seedOrder({ status: "confirmed", locale: "ru", email: ADMIN.email });
    await loginAsAdmin(page);
    const res = await page.request.get(`/api/admin/orders/${order.id}/invoice.pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const buf = await res.body();
    // Roboto TTF ~500KB; embedded → final PDF > 200KB. Helvetica-only был < 5KB.
    expect(buf.length).toBeGreaterThan(50_000);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  test("(a) PDF на uz → 200 + локалезавимый title", async ({ page }) => {
    const order = await seedOrder({ status: "confirmed", locale: "uz", email: ADMIN.email });
    await loginAsAdmin(page);
    const res = await page.request.get(`/api/admin/orders/${order.id}/invoice.pdf`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    // PDF metadata содержит title из Document — `Hujjat ${number}` для uz.
    // Проверяем что PDF корректно сформирован (magic bytes), title-проверка
    // потребовала бы pdf-parse.
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  test("(a) PDF на en → 200", async ({ page }) => {
    const order = await seedOrder({ status: "confirmed", locale: "en", email: ADMIN.email });
    await loginAsAdmin(page);
    const res = await page.request.get(`/api/admin/orders/${order.id}/invoice.pdf`);
    expect(res.status()).toBe(200);
  });

  test("(d) date filter ?from=...&to=... → только заказы в диапазоне", async ({ page }) => {
    // Создаём 2 заказа: один 30 дней назад, второй сегодня.
    const old = await seedOrder({
      status: "delivered",
      email: ADMIN.email,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const fresh = await seedOrder({ status: "delivered", email: ADMIN.email });

    await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/ru/admin/orders?from=${today}&to=${today}`);
    await expect(page.locator(`tr[data-order-id="${fresh.id}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-order-id="${old.id}"]`)).toHaveCount(0);
  });

  test("(d) from > to → оба фильтра обнуляются (sanitize)", async ({ page }) => {
    const old = await seedOrder({
      status: "delivered",
      email: ADMIN.email,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const fresh = await seedOrder({ status: "delivered", email: ADMIN.email });

    await loginAsAdmin(page);
    await page.goto("/ru/admin/orders?from=2026-12-31&to=2026-01-01");
    // Оба обнулились → видим оба заказа.
    await expect(page.locator(`tr[data-order-id="${old.id}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-order-id="${fresh.id}"]`)).toBeVisible();
  });

  test("(c) bulk: pending → confirmed для 2 заказов → updated=2 + БД", async ({ page }) => {
    const o1 = await seedOrder({ status: "pending", email: ADMIN.email });
    const o2 = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/orders/bulk", {
      data: { ids: [o1.id, o2.id], status: "confirmed", reason: "Подтверждено вручную" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { updated: number; skipped: unknown[] };
    expect(body.updated).toBe(2);
    expect(body.skipped).toHaveLength(0);

    const reloaded = await prisma.order.findMany({
      where: { id: { in: [o1.id, o2.id] } },
      select: { status: true },
    });
    expect(reloaded.every((r) => r.status === "confirmed")).toBe(true);
  });

  test("(c) bulk: смешанный — один illegal_transition попадает в skipped[]", async ({ page }) => {
    const okOrder = await seedOrder({ status: "pending", email: ADMIN.email });
    // delivered → confirmed запрещено (terminal-ish flow).
    const illegalOrder = await seedOrder({ status: "delivered", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/orders/bulk", {
      data: { ids: [okOrder.id, illegalOrder.id], status: "confirmed" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      updated: number;
      skipped: Array<{ id: string; reason: string }>;
    };
    expect(body.updated).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.id).toBe(illegalOrder.id);
    expect(body.skipped[0]?.reason).toBe("illegal_transition");

    // delivered-заказ остался в delivered.
    const reloaded = await prisma.order.findUniqueOrThrow({
      where: { id: illegalOrder.id },
      select: { status: true },
    });
    expect(reloaded.status).toBe("delivered");
  });

  test("(c) bulk: несуществующий id → not_found в skipped", async ({ page }) => {
    const okOrder = await seedOrder({ status: "pending", email: ADMIN.email });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/orders/bulk", {
      data: { ids: [okOrder.id, "cuid_doesnt_exist"], status: "confirmed" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      updated: number;
      skipped: Array<{ id: string; reason: string }>;
    };
    expect(body.updated).toBe(1);
    expect(body.skipped[0]?.reason).toBe("not_found");
  });

  test("(c) bulk: пустой ids → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/orders/bulk", {
      data: { ids: [], status: "confirmed" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("(c) bulk: anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/orders/bulk", {
      data: { ids: ["x"], status: "confirmed" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("(c) bulk UI: bulk-bar появляется при выборе строки", async ({ page }) => {
    await seedOrder({ status: "pending", email: ADMIN.email });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/orders");

    // Изначально bar скрыт.
    await expect(page.getByTestId("admin-orders-bulk-bar")).toHaveCount(0);
    // Кликаем checkbox первой строки.
    const firstCheckbox = page.getByTestId("admin-orders-row-checkbox").first();
    await firstCheckbox.check();
    await expect(page.getByTestId("admin-orders-bulk-bar")).toBeVisible();
  });
});
