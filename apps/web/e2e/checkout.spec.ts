/**
 * P4-T1: многошаговый чекаут — проверяем основные UI-контракты:
 *   - Гвард пустой корзины → редирект на /cart.
 *   - Stepper-индикатор показывает 5 шагов, клик по пройденному — возврат.
 *   - Валидация per-step (Contacts: email+phone); blur'ы + текст ошибок.
 *   - Review: показаны введённые данные + disabled «Оформить заказ» (WIP до P4-T5).
 *   - Persist: перезагрузка на шаге delivery сохраняет currentStep.
 *   - `robots: noindex, nofollow`.
 *
 * Server-логика (создание Order + Uniteller Signature) — P4-T5.
 */

import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:checkout-draft");
  });
});

async function fillCheckoutToReview(page: Page): Promise<void> {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/checkout");

  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByRole("button", { name: /^Далее$/ }).click(); // delivery
  await page.getByRole("button", { name: /^Далее$/ }).click(); // payment

  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
}

test("guard: пустая корзина → редирект на /cart", async ({ page }) => {
  await page.goto("/ru/checkout");
  await expect(page).toHaveURL(/\/ru\/cart$/);
});

test("/checkout имеет meta robots noindex, nofollow", async ({ page }) => {
  // Положим товар, чтобы сам checkout отрендерился (не редиректнулся).
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/checkout");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
  await expect(robots).toHaveAttribute("content", /nofollow/);
});

test("stepper-flow: заполняем контакты → адрес → доставка → оплата → review", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/checkout");
  await expect(page.getByRole("heading", { name: "Оформление заказа", level: 1 })).toBeVisible();

  // Step 1: Contacts.
  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Step 2: Address.
  await expect(page.getByRole("heading", { name: "Адрес доставки" })).toBeVisible();
  // Region: выбираем Андижан (однозначный вариант, чтобы не конкурировал
  // с «Ташкент» / «Ташкентская область»).
  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Step 3: Delivery — default courier уже выбран.
  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Step 4: Payment — default uniteller.
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Step 5: Review.
  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
  await expect(page.getByText("Иван Иванов")).toBeVisible();
  await expect(page.getByText("ivan@example.com")).toBeVisible();

  // «Оформить заказ» — disabled (WIP до P4-T5).
  const placeBtn = page.getByRole("button", { name: /Оформить заказ/ });
  await expect(placeBtn).toBeDisabled();
});

test("валидация: Contacts без email/phone не пропускает дальше", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/checkout");

  // Заполняем только имя.
  await page.getByLabel("Имя", { exact: true }).fill("Иван");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Остаёмся на том же шаге — заголовок «Ваши контакты» по-прежнему виден.
  await expect(page.getByRole("heading", { name: "Ваши контакты" })).toBeVisible();
});

test("Review (гость): показан warning-Alert с предложением войти/создать аккаунт", async ({
  page,
}) => {
  await fillCheckoutToReview(page);

  // Warning-Alert с призывом войти.
  await expect(page.getByText("Войдите, чтобы оформить заказ")).toBeVisible();
  await expect(
    page.getByText(
      "Для оформления нужен аккаунт: так вы получите историю заказов и сможете отслеживать доставку.",
    ),
  ).toBeVisible();

  // Кнопки внутри warning-Alert (чтобы не конкурировать с «Войти» в шапке).
  const alert = page.getByRole("alert").filter({ hasText: "Войдите, чтобы оформить заказ" });
  const signIn = alert.getByRole("link", { name: /^Войти$/ });
  const signUp = alert.getByRole("link", { name: "Создать аккаунт" });
  await expect(signIn).toHaveAttribute("href", /\/auth\/login\?returnTo=%2Fru%2Fcheckout/);
  await expect(signUp).toHaveAttribute("href", /\/auth\/register\?returnTo=%2Fru%2Fcheckout/);

  // «Оформить заказ» — disabled для гостя независимо от способа оплаты.
  await expect(page.getByRole("button", { name: /Оформить заказ/ })).toBeDisabled();
});

test("Review: «Вернуться в корзину» ведёт на /ru/cart", async ({ page }) => {
  await fillCheckoutToReview(page);
  await page.getByRole("link", { name: /Вернуться в корзину/ }).click();
  await expect(page).toHaveURL(/\/ru\/cart$/);
});

test.describe("Review (залогинен)", () => {
  const USER = {
    email: "e2e-checkout-review@bigmax.uz",
    password: "e2ePass1234",
    name: "E2E Checkout",
  };

  test.beforeEach(async ({ page }) => {
    await createTestUser(USER);
    // Логинимся.
    await page.goto("/ru/auth/login");
    await page.locator("input#email").fill(USER.email);
    await page.locator("input#password").fill(USER.password);
    await page.getByRole("button", { name: /^Войти$/ }).click();
    await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("Uniteller-ветка активна, warning-Alert отсутствует; «Оформить заказ» enabled", async ({
    page,
  }) => {
    await fillCheckoutToReview(page);

    // Auth-prompt НЕ должен быть виден.
    await expect(page.getByText("Войдите, чтобы оформить заказ")).not.toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /^Войти$/ })).toHaveCount(0);

    // После P4-T5 для авт-юзера с Uniteller-оплатой кнопка активна (click отправляет на /api/checkout/pay).
    await expect(page.getByRole("button", { name: /Оформить заказ/ })).toBeEnabled();
  });
});

test("persist: draft сохраняется в localStorage при переходах между шагами", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/checkout");

  await page.getByLabel("Имя", { exact: true }).fill("Persist Test");
  await page.getByLabel("Email", { exact: true }).fill("persist@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901111111");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // localStorage contains the draft.
  const draft = await page.evaluate(() => localStorage.getItem("bigmax:checkout-draft"));
  expect(draft).not.toBeNull();
  const parsed = JSON.parse(draft!) as { state: { contacts: { name: string } } };
  expect(parsed.state.contacts.name).toBe("Persist Test");

  // Reload — currentStep должен остаться на «address».
  await page.reload();
  await expect(page.getByRole("heading", { name: "Адрес доставки" })).toBeVisible();
});
