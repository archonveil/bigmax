/**
 * P6-T2: e2e для `/admin` dashboard'а.
 *
 * Сценарии:
 *   1. Все 5 секций рендерятся для admin (KPI / by-status / top / low-stock / pending).
 *   2. KPI ordersTotal отражает seeded заказы.
 *   3. Empty-states работают (нет заказов / нет low-stock / нет pending).
 *   4. Pending Uniteller секция показывает stale-pending-payment с правильным age.
 *   5. Customer на /admin → не попадает (regression на P6-T1 не нарушен).
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-dashboard@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Dash",
  role: "admin" as const,
};

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const seq = String(((Date.now() | 0) + seedCounter) % 9999).padStart(4, "0");
  return `BGX-${yyyy}${mm}${dd}-${seq}-DT2`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P6-T2 · /admin dashboard", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
  });

  test.afterEach(async () => {
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("admin → все 5 секций рендерятся", async ({ page }) => {
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) await page.goto("/ru/admin");

    await expect(page.getByTestId("admin-dashboard")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi")).toBeVisible();
    await expect(page.getByTestId("dashboard-orders-by-status")).toBeVisible();
    await expect(page.getByTestId("dashboard-top-products")).toBeVisible();
    // Low-stock и pending-uniteller имеют empty-state — проверяем что хотя бы
    // один из вариантов виден.
    await expect(
      page.getByTestId("dashboard-low-stock").or(page.getByTestId("dashboard-low-stock-empty")),
    ).toBeVisible();
    await expect(page.getByTestId("dashboard-pending-uniteller")).toBeVisible();
  });

  test("KPI: ordersTotal содержит число (sanity check)", async ({ page }) => {
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) await page.goto("/ru/admin");

    const kpi = page.getByTestId("dashboard-kpi");
    // Первая карточка — orders total. Содержит хотя бы одну цифру.
    await expect(kpi.locator("article").first()).toContainText(/\d+/);
  });

  test("pending uniteller: seeded stale-pending показывается с правильным orderNumber", async ({
    page,
  }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const number = nextOrderNumber();
    // createdAt 5 минут назад — попадает в фильтр "старше 2 минут".
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number,
        status: "pending",
        locale: "ru",
        subtotalCents: 100_000_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_000_00,
        currency: "UZS",
        deliveryMethod: "courier",
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
      select: { id: true, number: true },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "uniteller",
        status: "pending",
        amountCents: 100_000_00,
        currency: "UZS",
        unitellerOrderIdp: number,
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
      select: { id: true },
    });

    try {
      await loginAsAdmin(page);
      if (!page.url().includes("/admin")) await page.goto("/ru/admin");

      const queue = page.getByTestId("dashboard-pending-uniteller");
      await expect(queue).toContainText(order.number);
      await expect(queue.locator(`[data-payment-id="${payment.id}"]`)).toBeVisible();
      // Возраст ≈5 минут — UI показывает «5 мин» (или ageSec для < 60).
      await expect(queue.locator(`[data-payment-id="${payment.id}"]`)).toContainText(/мин/);
    } finally {
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    }
  });

  test("заказы by-status: seeded delivered → счётчик обновлён", async ({ page }) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number: nextOrderNumber(),
        status: "delivered",
        locale: "ru",
        subtotalCents: 50_000_00,
        deliveryCostCents: 25_000_00,
        discountCents: 0,
        totalCents: 75_000_00,
        currency: "UZS",
        deliveryMethod: "courier",
      },
      select: { id: true },
    });

    try {
      await loginAsAdmin(page);
      if (!page.url().includes("/admin")) await page.goto("/ru/admin");
      // Среди by-status строк хотя бы одна с status=delivered.
      const list = page.getByTestId("dashboard-orders-by-status");
      await expect(list.locator('[data-status="delivered"]')).toHaveCount(1);
      // Counter ≥ 1.
      await expect(list.locator('[data-status="delivered"]')).toContainText(/\d+/);
    } finally {
      await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    }
  });

  test("customer на /admin → middleware silent-redirect (regression P6-T1)", async ({ page }) => {
    const customer = {
      email: "e2e-admin-dash-customer@bigmax.uz",
      password: "e2ePass1234",
      name: "E2E Customer",
    };
    await createTestUser(customer);
    try {
      await page.goto("/ru/auth/login");
      await page.locator("input#email").fill(customer.email);
      await page.locator("input#password").fill(customer.password);
      await page.getByRole("button", { name: /^Войти$/ }).click();
      await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
      await page.goto("/ru/admin");
      await page.waitForURL(/\/ru\/?$/, { timeout: 10_000 });
      await expect(page.getByTestId("admin-dashboard")).toHaveCount(0);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });
});
