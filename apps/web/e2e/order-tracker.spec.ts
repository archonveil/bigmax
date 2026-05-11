/**
 * P5-T3: e2e для `<OrderTracker>` на детальной странице.
 *
 * Покрываем:
 *   - pending → все шаги upcoming + pendingPreflight=true caption.
 *   - confirmed → confirmed=current, остальные upcoming.
 *   - packing → confirmed=done, packing=current.
 *   - shipped → confirmed/packing=done, shipped=current.
 *   - delivered → все done.
 *   - cancelled → terminal-блок с правильным контентом, stepper НЕ рендерится.
 *   - refunded → terminal-refunded блок.
 *
 * Используем `data-step={key}` + `data-step-state={state}` атрибуты как
 * стабильный селектор — их же сохранит P6 когда мы добавим timestamps.
 */

import { prisma, type OrderStatus } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-order-tracker@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Tracker",
};

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const seq = String(((Date.now() | 0) + seedCounter) % 9999).padStart(4, "0");
  return `BGX-${yyyy}${mm}${dd}-${seq}-T3`;
}

async function seedOrder(orderStatus: OrderStatus): Promise<{ id: string; number: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });
  const number = nextOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: orderStatus,
      locale: "ru",
      subtotalCents: 50_000_00,
      deliveryCostCents: 25_000_00,
      discountCents: 0,
      totalCents: 75_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
    },
    select: { id: true, number: true },
  });
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "uniteller",
      status: orderStatus === "pending" ? "pending" : "captured",
      amountCents: 75_000_00,
      currency: "UZS",
      ...(orderStatus !== "pending" ? { capturedAt: new Date() } : {}),
    },
  });
  return order;
}

async function login(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P5-T3 · OrderTracker", () => {
  test.beforeEach(async () => {
    await createTestUser(USER);
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("pending → 4 шага upcoming + caption pendingPreflight", async ({ page }) => {
    const order = await seedOrder("pending");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker).toHaveAttribute("data-tracker-kind", "stepper");
    await expect(tracker).toHaveAttribute("data-tracker-pending", "true");
    for (const key of ["confirmed", "packing", "shipped", "delivered"]) {
      await expect(tracker.locator(`[data-step="${key}"]`)).toHaveAttribute(
        "data-step-state",
        "upcoming",
      );
    }
    await expect(tracker).toContainText(/Ожидаем подтверждения/);
  });

  test("confirmed → confirmed=current, остальные upcoming", async ({ page }) => {
    const order = await seedOrder("confirmed");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker.locator('[data-step="confirmed"]')).toHaveAttribute(
      "data-step-state",
      "current",
    );
    for (const key of ["packing", "shipped", "delivered"]) {
      await expect(tracker.locator(`[data-step="${key}"]`)).toHaveAttribute(
        "data-step-state",
        "upcoming",
      );
    }
    await expect(tracker).toHaveAttribute("data-tracker-pending", "false");
  });

  test("packing → confirmed=done, packing=current", async ({ page }) => {
    const order = await seedOrder("packing");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker.locator('[data-step="confirmed"]')).toHaveAttribute(
      "data-step-state",
      "done",
    );
    await expect(tracker.locator('[data-step="packing"]')).toHaveAttribute(
      "data-step-state",
      "current",
    );
  });

  test("shipped → confirmed+packing done, shipped=current", async ({ page }) => {
    const order = await seedOrder("shipped");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker.locator('[data-step="confirmed"]')).toHaveAttribute(
      "data-step-state",
      "done",
    );
    await expect(tracker.locator('[data-step="packing"]')).toHaveAttribute(
      "data-step-state",
      "done",
    );
    await expect(tracker.locator('[data-step="shipped"]')).toHaveAttribute(
      "data-step-state",
      "current",
    );
    await expect(tracker.locator('[data-step="delivered"]')).toHaveAttribute(
      "data-step-state",
      "upcoming",
    );
  });

  test("delivered → все done, current отсутствует", async ({ page }) => {
    const order = await seedOrder("delivered");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    for (const key of ["confirmed", "packing", "shipped", "delivered"]) {
      await expect(tracker.locator(`[data-step="${key}"]`)).toHaveAttribute(
        "data-step-state",
        "done",
      );
    }
    await expect(tracker.locator('[data-step-state="current"]')).toHaveCount(0);
  });

  test("cancelled → terminal-блок, stepper не рендерится", async ({ page }) => {
    const order = await seedOrder("cancelled");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker).toHaveAttribute("data-tracker-kind", "terminal");
    await expect(tracker).toHaveAttribute("data-tracker-terminal", "cancelled");
    await expect(tracker).toContainText(/Заказ отменён/);
    // Никаких step'ов
    await expect(tracker.locator("[data-step]")).toHaveCount(0);
  });

  test("refunded → terminal refunded блок", async ({ page }) => {
    const order = await seedOrder("refunded");
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    const tracker = page.getByTestId("order-tracker");
    await expect(tracker).toHaveAttribute("data-tracker-terminal", "refunded");
    await expect(tracker).toContainText(/Средства возвращены/);
  });
});
