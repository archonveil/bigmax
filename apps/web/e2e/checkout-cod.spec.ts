/**
 * P4-T8: COD (наложенный платёж). Полный UI-flow:
 *   1. Залогиненный юзер → checkout → выбирает «При получении» в payment.
 *   2. Кнопка «Оформить заказ» — enabled (раньше была disabled до P4-T8).
 *   3. Click → POST /api/checkout/pay c method=cod → JSON c redirectTo.
 *   4. Browser navigation на /[locale]/orders/[id]/success.
 *   5. Success-page показывает «Заказ принят» (COD Alert) вместо «Оплата прошла».
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-checkout-cod@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E COD",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:checkout-draft");
  });
  await createTestUser(USER);
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
});

test.afterEach(async () => {
  await deleteTestUser(USER.email);
});

test("полный UI flow: COD → редирект на success → COD Alert «Заказ принят»", async ({ page }) => {
  await fillCheckoutToReviewWithCod(page);

  // Кнопка теперь enabled (P4-T8 убрала disabled-гейт для COD).
  await expect(page.getByRole("button", { name: /Оформить заказ/ })).toBeEnabled();

  await page.getByRole("button", { name: /Оформить заказ/ }).click();

  // Браузер должен оказаться на /ru/orders/{id}/success.
  await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 10_000 });

  // Заголовок success-страницы.
  await expect(page.getByRole("heading", { name: "Спасибо за заказ в Бигмах!" })).toBeVisible();
  // COD-Alert вместо «Оплата прошла».
  await expect(page.getByText("Заказ принят")).toBeVisible();
  await expect(page.getByText(/Оплата при получении наличными или картой курьеру/)).toBeVisible();

  // «Оплата прошла» — НЕ должен быть виден (это Uniteller-вариант).
  await expect(page.getByText("Оплата прошла")).not.toBeVisible();

  // CTA: «Мои заказы» + «Продолжить покупки» (не «Вернуться в корзину»).
  await expect(page.getByRole("link", { name: /Мои заказы/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Продолжить покупки/ })).toBeVisible();
});

test("после COD-чекаута корзина и draft очищены", async ({ page }) => {
  await fillCheckoutToReviewWithCod(page);
  await page.getByRole("button", { name: /Оформить заказ/ }).click();
  await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 10_000 });

  const cart = await page.evaluate(() => localStorage.getItem("bigmax:cart"));
  const cartItems = cart ? (JSON.parse(cart) as { state: { items: unknown[] } }).state.items : [];
  expect(cartItems).toHaveLength(0);

  // checkout-draft тоже сброшен (currentStep=contacts).
  const draft = await page.evaluate(() => localStorage.getItem("bigmax:checkout-draft"));
  if (draft) {
    const parsed = JSON.parse(draft) as { state: { currentStep?: string } };
    expect(parsed.state.currentStep).toBe("contacts");
  }
});

test("Order+Payment в БД: provider=cod, status=pending, unitellerOrderIdp=null", async ({
  page,
}) => {
  await fillCheckoutToReviewWithCod(page);
  await page.getByRole("button", { name: /Оформить заказ/ }).click();
  await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 10_000 });

  const url = page.url();
  const orderId = /\/orders\/([^/]+)\/success/.exec(url)?.[1];
  expect(orderId).toBeTruthy();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId! },
    include: { payments: true, items: true },
  });
  expect(order.status).toBe("pending");
  expect(order.deliveryMethod).toBe("courier");
  expect(order.payments).toHaveLength(1);
  expect(order.payments[0]!.provider).toBe("cod");
  expect(order.payments[0]!.status).toBe("pending");
  expect(order.payments[0]!.unitellerOrderIdp).toBeNull();
  expect(order.items).toHaveLength(1);
});

async function fillCheckoutToReviewWithCod(page: Page): Promise<void> {
  await page.goto("/ru/product/nuby-cherry-pacifier");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/ru/checkout");

  // Contacts
  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Address
  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Delivery (default courier)
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Payment — переключаем на COD.
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await page.getByText("При получении").first().click();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
}
