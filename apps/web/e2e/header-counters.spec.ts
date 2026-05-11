/**
 * P3-T5: счётчики на иконках Header.
 *
 * CartButton бейдж покрыт в cart-flow.spec.ts; здесь отдельный модуль для
 * FavoritesHeaderButton:
 *  - до добавления — бейдж скрыт,
 *  - после toggle — «1», «2»… c cap «9+»,
 *  - клик по иконке навигирует на /favorites.
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:favorites"));
});

test("favorites badge: скрыт при count=0, растёт на toggle", async ({ page }) => {
  const favBtn = page.getByRole("link", { name: "Открыть избранное" }).first();
  // До каких-либо действий бейдж отсутствует.
  await expect(favBtn.locator("span[aria-hidden]")).toHaveCount(0);

  // Добавляем первый товар в избранное через карточку.
  await page.locator("article").first().getByRole("button", { name: "В избранное" }).click();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");

  // Добавляем второй (через другую карточку — используем nth(1)).
  await page.locator("article").nth(1).getByRole("button", { name: "В избранное" }).click();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("2");
});

test("favorites badge cap: при >9 показывает «9+»", async ({ page }) => {
  // На главной / в diapers не хватит карточек. Идём в search, который даёт
  // 24 mock-товаров на первой странице (все имеют FavoriteButton независимо
  // от stock).
  await page.goto("/ru/search?q=mock");
  await page.evaluate(() => localStorage.removeItem("bigmax:favorites"));
  await page.reload(); // rehydrate empty favorites

  const articles = page.locator("article");
  for (let i = 0; i < 10; i += 1) {
    await articles.nth(i).getByRole("button", { name: "В избранное" }).click();
  }

  const favBtn = page.getByRole("link", { name: "Открыть избранное" }).first();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("9+");
});

test("клик по favorites-кнопке ведёт на /favorites", async ({ page }) => {
  await page.getByRole("link", { name: "Открыть избранное" }).first().click();
  await expect(page).toHaveURL(/\/ru\/favorites/);
  await expect(page.getByRole("heading", { name: "Избранное", level: 1 })).toBeVisible();
});
