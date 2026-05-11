/**
 * P3-T3: страница `/cart` + промокод.
 *
 * - Пустая корзина → empty-state + «Перейти в каталог».
 * - Добавляем товар → /cart показывает позицию, subtotal, CTA «Перейти к оформлению».
 * - Применение WELCOME10 при subtotal ≥ 100 000 сум → показывается скидка.
 * - Невалидный код → toast ошибки, промо не применяется.
 * - Subtotal < minOrder → toast `promoMinOrder`, промо не применяется.
 * - /cart — noindex (robots меta).
 * - robots.txt содержит Disallow для cart под всеми локалями.
 */

import { expect, test } from "@playwright/test";

/**
 * Спец делает cross-page navigation (/ru → /ru/cart), поэтому вместо
 * `addInitScript` (срабатывает на каждый reload и стирает корзину между
 * шагами) чистим один раз через `page.evaluate` после первого goto.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:cart"));
});

test("пустой /cart показывает empty-state + CTA в каталог", async ({ page }) => {
  await page.goto("/ru/cart"); // origin уже /ru после beforeEach → localStorage сохраняется
  await expect(page.getByRole("heading", { name: "Корзина", level: 1 })).toBeVisible();
  await expect(page.getByText("Корзина пуста")).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти в каталог" })).toBeVisible();
});

test("после add-to-cart /cart показывает позицию + subtotal + CTA", async ({ page }) => {
  // beforeEach уже навигировал на /ru и очистил localStorage.
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "В корзину" }).click();

  await page.goto("/ru/cart"); // same-origin reload — localStorage сохраняется
  await expect(page.getByRole("heading", { name: "Корзина", level: 1 })).toBeVisible();
  await expect(page.getByText(/Mock-товар/)).toBeVisible();

  await expect(page.getByText("Сумма товаров")).toBeVisible();
  await expect(page.getByText("Итого", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Перейти к оформлению/ })).toBeVisible();
});

test("промо WELCOME10: применяется при subtotal ≥ 100 000 сум, показывает скидку", async ({
  page,
}) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/cart");

  await page.getByLabel("Промокод").fill("WELCOME10");
  await page.getByRole("button", { name: "Применить" }).click();

  // Toast и summary-plate — оба содержат «Применён WELCOME10»; проверим
  // конкретно в summary (complementary role) и строку «Скидка» рядом.
  await expect(page.getByRole("complementary").getByText(/Применён WELCOME10/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Скидка")).toBeVisible();
});

test("невалидный промо → toast 'Неверный промокод'", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/cart");

  await page.getByLabel("Промокод").fill("DOESNOTEXIST");
  await page.getByRole("button", { name: "Применить" }).click();

  await expect(page.getByText("Неверный промокод")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Применён/)).toHaveCount(0);
});

test("/cart имеет meta robots noindex", async ({ page }) => {
  await page.goto("/ru/cart");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("robots.txt содержит Disallow /*/cart", async ({ request }) => {
  const r = await request.get("/robots.txt");
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).toMatch(/Disallow:\s*\/\*\/cart/);
});

test("clearCart: AlertDialog подтверждения → корзина очищается", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/cart");

  // Кнопка «Очистить корзину» в aside.
  await page.getByRole("button", { name: "Очистить корзину" }).first().click();

  // AlertDialog c заголовком + confirm action.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Удалить все позиции из корзины?")).toBeVisible();

  // Клик по action кнопке очищает корзину → empty state.
  await dialog.getByRole("button", { name: "Очистить корзину" }).click();
  await expect(page.getByText("Корзина пуста")).toBeVisible();
});

test("clearCart: Cancel в AlertDialog не очищает корзину", async ({ page }) => {
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/cart");

  await page.getByRole("button", { name: "Очистить корзину" }).first().click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Отмена" }).click();

  // Позиция на месте.
  await expect(page.getByText(/Mock-товар/)).toBeVisible();
  await expect(page.getByText("Корзина пуста")).toHaveCount(0);
});
