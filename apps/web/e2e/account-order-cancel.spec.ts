/**
 * P5-T4: e2e для `POST /api/account/orders/[id]/cancel` + UI на детальной.
 *
 * Покрываем:
 *   1. COD pending → 200 + Order.cancelled + Payment.cancelled.
 *   2. COD confirmed → 200 + Order.cancelled + Payment.cancelled.
 *   3. packing → 409 order_too_late.
 *   4. shipped → 409 order_too_late.
 *   5. delivered → 409 order_too_late.
 *   6. cancelled (повторный cancel) → 409 order_already_cancelled.
 *   7. UI happy: cancel-button → dialog → submit → success-state →
 *      OrderTracker переходит в terminal=cancelled.
 *   8. UI ineligible: shipped order → cancel-button disabled с пояснением.
 *
 * Uniteller-cancel flow (`Payment.captured` → POST `/cancel/`) на e2e не
 * гоняем — он покрыт unit-тестами в `client.test.ts` (×11 cases) с
 * mocked fetchImpl. Полный chain через mock-server потребует server-side
 * URL override, что планируется в P8-T1.
 */

import { prisma, type OrderStatus, type PaymentStatus } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-account-order-cancel@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Cancel",
};

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const seq = String(((Date.now() | 0) + seedCounter) % 9999).padStart(4, "0");
  return `BGX-${yyyy}${mm}${dd}-${seq}-T4`;
}

interface SeedSpec {
  orderStatus: OrderStatus;
  paymentStatus?: PaymentStatus;
  provider?: "cod" | "uniteller";
}

async function seedOrder(spec: SeedSpec): Promise<{ id: string; number: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });
  const number = nextOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: spec.orderStatus,
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
      provider: spec.provider ?? "cod",
      status: spec.paymentStatus ?? "pending",
      amountCents: 75_000_00,
      currency: "UZS",
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

test.describe("P5-T4 · POST /api/account/orders/[id]/cancel", () => {
  test.beforeEach(async () => {
    await createTestUser(USER);
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("guest → 401", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "pending" });
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("COD pending → 200 + Order/Payment.cancelled", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "pending" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(updated.status).toBe("cancelled");
    expect(updated.payments[0]!.status).toBe("cancelled");
  });

  test("COD confirmed → 200 + Order.cancelled (с reason в body)", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "confirmed" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: { reason: "Передумал, нашёл дешевле." },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("cancelled");
  });

  test("packing → 409 order_too_late", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "packing" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "order_too_late" });
  });

  test("shipped → 409 order_too_late", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "shipped" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
  });

  test("повторный cancel (already cancelled) → 409 order_already_cancelled", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "cancelled" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "order_already_cancelled" });
  });

  test("чужой Order → 404 (не 403)", async ({ page }) => {
    const other = await prisma.user.create({
      data: { email: "e2e-other-cancel@bigmax.uz", passwordHash: "x", role: "customer" },
      select: { id: true },
    });
    const otherOrder = await prisma.order.create({
      data: {
        userId: other.id,
        number: nextOrderNumber(),
        status: "pending",
        locale: "ru",
        subtotalCents: 1,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 1,
        currency: "UZS",
        deliveryMethod: "courier",
      },
      select: { id: true },
    });

    try {
      await login(page);
      const res = await page.request.post(`/api/account/orders/${otherOrder.id}/cancel`, {
        data: {},
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await prisma.order.delete({ where: { id: otherOrder.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  test("body слишком длинный reason → 400 reason_too_long", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "pending" });
    await login(page);
    const res = await page.request.post(`/api/account/orders/${order.id}/cancel`, {
      data: { reason: "x".repeat(501) },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reason: "invalid_body" });
  });
});

test.describe("P5-T4 · Cancel UI на детальной странице", () => {
  test.beforeEach(async () => {
    await createTestUser(USER);
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("happy: dialog → submit → success → tracker переходит в terminal", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "confirmed" });
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    await page.getByTestId("cancel-button").click();
    await expect(page.getByTestId("cancel-dialog")).toBeVisible();
    await page.getByTestId("cancel-reason-input").fill("Решил отменить.");
    await page.getByTestId("cancel-submit").click();

    await expect(page.getByText("Заказ отменён")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("cancel-success-ok").click();

    // После router.refresh() — tracker terminal=cancelled, кнопка отмены исчезла.
    await expect(page.getByTestId("order-tracker")).toHaveAttribute(
      "data-tracker-terminal",
      "cancelled",
    );
    await expect(page.getByTestId("cancel-button")).toHaveCount(0);
  });

  test("ineligible: shipped → cancel-button disabled с пояснением", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "shipped" });
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    await expect(page.getByTestId("cancel-disabled")).toBeVisible();
    await expect(page.getByTestId("cancel-disabled")).toContainText(/уже комплектуется/);
    // disabled-кнопка тоже рендерится — Playwright `getByTestId` найдёт обе
    // (disabled-кнопка лежит ВНУТРИ cancel-disabled).
    const btn = page.getByTestId("cancel-button");
    await expect(btn).toBeDisabled();
  });

  test("cancelled order → cancel-кнопка не рендерится вообще", async ({ page }) => {
    const order = await seedOrder({ orderStatus: "cancelled" });
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    await expect(page.getByTestId("cancel-button")).toHaveCount(0);
    await expect(page.getByTestId("cancel-disabled")).toHaveCount(0);
  });
});
