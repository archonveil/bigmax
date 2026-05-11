/**
 * P4-T7: return-страницы Uniteller `/orders/[orderId]/{success|failure|return}`.
 *
 * Покрытие:
 *   1. API `GET /api/orders/[id]/status` — 401 гость, 404 на чужой Order,
 *      200 на свой с корректным payload.
 *   2. Success-страница как owner: видим заголовок «Спасибо за заказ»,
 *      номер заказа, ссылку «Мои заказы».
 *   3. Success-страница для captured-Payment'а: видим «Оплата прошла»
 *      Alert (terminal state, polling не запускается).
 *   4. Failure-страница для failed-Payment'а: видим Alert с «Платёж отклонён».
 *   5. Гость на success → redirect на /auth/login.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-order-return@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Returns",
};

interface SeededOrder {
  orderId: string;
  number: string;
  paymentId: string;
}

async function seedOrder(paymentStatus: "pending" | "captured" | "failed"): Promise<SeededOrder> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });
  const seq = String(((Date.now() / 100) | 0) % 9999).padStart(4, "0");
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const number = `BGX-${yyyy}${mm}${dd}-${seq}`;

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: paymentStatus === "captured" ? "confirmed" : "pending",
      locale: "ru",
      subtotalCents: 25_000_00,
      deliveryCostCents: 50_000_00,
      discountCents: 0,
      totalCents: 75_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "uniteller",
      status: paymentStatus,
      amountCents: 75_000_00,
      currency: "UZS",
      unitellerOrderIdp: number,
      ...(paymentStatus === "captured" ? { capturedAt: new Date() } : {}),
    },
  });
  return { orderId: order.id, number, paymentId: payment.id };
}

async function login(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.beforeEach(async () => {
  await createTestUser(USER);
});

test.afterEach(async () => {
  await deleteTestUser(USER.email);
});

test("API: гость → 401", async ({ request }) => {
  const res = await request.get("/api/orders/some-fake-id/status");
  expect(res.status()).toBe(401);
});

test("API: свой Order → 200 + корректный payload", async ({ page }) => {
  await login(page);
  const seed = await seedOrder("captured");

  const res = await page.request.get(`/api/orders/${seed.orderId}/status`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body["id"]).toBe(seed.orderId);
  expect(body["number"]).toBe(seed.number);
  expect(body["status"]).toBe("confirmed");
  expect(body["paymentStatus"]).toBe("captured");
  expect(body["paymentProvider"]).toBe("uniteller");
  expect(body["totalCents"]).toBe(75_000_00);
  expect(body["currency"]).toBe("UZS");
});

test("API: чужой Order → 404 (не раскрываем существование)", async ({ page }) => {
  await login(page);

  // Создаём заказ от другого юзера через прямой Prisma-инсёрт.
  const other = await prisma.user.create({
    data: {
      email: "e2e-other-owner@bigmax.uz",
      passwordHash: "x",
      name: "Other",
      role: "customer",
      language: "ru",
    },
  });
  const today = new Date();
  const seq = "9000";
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const number = `BGX-${yyyy}${mm}${dd}-${seq}`;
  const otherOrder = await prisma.order.create({
    data: {
      userId: other.id,
      number,
      status: "pending",
      locale: "ru",
      subtotalCents: 100_00,
      deliveryCostCents: 0,
      discountCents: 0,
      totalCents: 100_00,
      currency: "UZS",
      deliveryMethod: "pickup",
    },
  });
  await prisma.payment.create({
    data: {
      orderId: otherOrder.id,
      provider: "uniteller",
      status: "pending",
      amountCents: 100_00,
      currency: "UZS",
      unitellerOrderIdp: number,
    },
  });

  const res = await page.request.get(`/api/orders/${otherOrder.id}/status`);
  expect(res.status()).toBe(404);

  // Cleanup
  await prisma.payment.deleteMany({ where: { orderId: otherOrder.id } });
  await prisma.order.delete({ where: { id: otherOrder.id } });
  await prisma.user.delete({ where: { id: other.id } });
});

test("Success-страница: pending payment → видим polling alert + номер заказа", async ({ page }) => {
  await login(page);
  const seed = await seedOrder("pending");

  await page.goto(`/ru/orders/${seed.orderId}/success`);
  await expect(page.getByRole("heading", { name: "Спасибо за заказ в Бигмах!" })).toBeVisible();
  await expect(page.getByText(`Заказ № ${seed.number}`)).toBeVisible();
  await expect(page.getByText("Подтверждаем оплату")).toBeVisible();
});

test("Success-страница: captured payment → terminal alert «Оплата прошла»", async ({ page }) => {
  await login(page);
  const seed = await seedOrder("captured");

  await page.goto(`/ru/orders/${seed.orderId}/success`);
  await expect(page.getByRole("heading", { name: "Спасибо за заказ в Бигмах!" })).toBeVisible();
  await expect(page.getByText("Оплата прошла")).toBeVisible();
  await expect(page.getByRole("link", { name: /Мои заказы/ })).toBeVisible();
});

test("Failure-страница: failed payment → destructive alert", async ({ page }) => {
  await login(page);
  const seed = await seedOrder("failed");

  await page.goto(`/ru/orders/${seed.orderId}/failure`);
  await expect(page.getByRole("heading", { name: "Оплата не прошла" })).toBeVisible();
  await expect(page.getByText("Платёж отклонён")).toBeVisible();
  await expect(page.getByRole("link", { name: /Вернуться в корзину/ })).toBeVisible();
});

test("Гость на success → redirect на /auth/login с returnTo", async ({ page }) => {
  // Создаём seed-заказ через временный логин, потом logout (clear cookies).
  await login(page);
  const seed = await seedOrder("captured");
  await page.context().clearCookies();

  await page.goto(`/ru/orders/${seed.orderId}/success`);
  await expect(page).toHaveURL(/\/ru\/auth\/login\?returnTo=/);
});
