/**
 * P3-T6: persist-тесты для cart / favorites / promo.
 *
 * Zustand + persist middleware хранит state в `localStorage`. После
 * `page.reload()` state должен восстановиться. Проверяем:
 *   - Cart items пережили reload;
 *   - Applied promo пережил reload (разрешено через партиализацию {items, appliedPromo});
 *   - Favorites items пережили reload.
 *
 * Эти тесты гарантируют, что `partialize` и `onRehydrateStorage` в store'ах
 * работают правильно на прод-путях.
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:favorites");
  });
});

test("cart items сохраняются после reload", async ({ page }) => {
  // Добавляем 2 единицы дефолтного варианта первой featured карточки.
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "В корзину" }).click();
  await firstCard.getByRole("button", { name: "Увеличить количество" }).click();

  const cartBtn = page.getByRole("button", { name: "Открыть корзину" }).first();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("2");

  // Reload.
  await page.reload();
  // После rehydrate бейдж снова показывает «2».
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("2");
});

test("applied promo сохраняется после reload на /cart", async ({ page }) => {
  // Добавляем товар + применяем WELCOME10.
  await page.locator("article").first().getByRole("button", { name: "В корзину" }).click();
  await page.goto("/ru/cart");

  await page.getByLabel("Промокод").fill("WELCOME10");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByRole("complementary").getByText(/Применён WELCOME10/)).toBeVisible({
    timeout: 5_000,
  });

  // Reload /cart — плашка «Применён WELCOME10» возвращается.
  await page.reload();
  await expect(page.getByRole("complementary").getByText(/Применён WELCOME10/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Скидка")).toBeVisible();
});

test("favorites items сохраняются после reload", async ({ page }) => {
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "В избранное" }).click();

  const favBtn = page.getByRole("link", { name: "Открыть избранное" }).first();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");

  await page.reload();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");

  // На /favorites карточка тоже сохранилась.
  await page.goto("/ru/favorites");
  await expect(page.getByText(/Mock-товар/)).toBeVisible();
});
