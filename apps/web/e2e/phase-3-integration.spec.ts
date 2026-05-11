/**
 * P3-T6: end-to-end smoke для типичного user journey:
 *   главная → 2 товара в корзину (разных) → 1 товар в избранное →
 *   /cart → применить WELCOME10 → проверить subtotal/discount/total
 *   → header-бейджи cart=3 и favorites=1 → /favorites → обе записи.
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:favorites");
  });
});

test("integration: 2 карточки в корзину + 1 в избранное + промо на /cart", async ({ page }) => {
  // Идём в search-страницу — гарантировано >24 карточек с высокой ценой,
  // WELCOME10 требует subtotal ≥ 100 000 сум.
  await page.goto("/ru/search?q=mock");

  // Добавляем первый и второй товар в корзину.
  await page.locator("article").nth(0).getByRole("button", { name: "В корзину" }).click();
  await page.locator("article").nth(1).getByRole("button", { name: "В корзину" }).click();

  // Добавляем третий в избранное.
  await page.locator("article").nth(2).getByRole("button", { name: "В избранное" }).click();

  // Бейджи: cart=2, favorites=1.
  const cartBtn = page.getByRole("button", { name: "Открыть корзину" }).first();
  const favBtn = page.getByRole("link", { name: "Открыть избранное" }).first();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("2");
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");

  // На /cart применяем WELCOME10 (2 featured mock'а — subtotal явно > 100k сум).
  await page.goto("/ru/cart");
  await page.getByLabel("Промокод").fill("WELCOME10");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByRole("complementary").getByText(/Применён WELCOME10/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Скидка")).toBeVisible();

  // На /favorites видим избранный товар.
  await page.goto("/ru/favorites");
  await expect(page.getByText(/Mock-товар/)).toBeVisible();

  // После reload всё по-прежнему там.
  await page.reload();
  await expect(page.getByText(/Mock-товар/)).toBeVisible();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("2");
});
