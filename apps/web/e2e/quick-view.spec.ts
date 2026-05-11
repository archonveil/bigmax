/**
 * P2-T5+QV (scope-expansion): Quick View на карточке товара.
 * - Overlay-кнопка над картинкой открывает модалку.
 * - Модалка лениво фетчит ProductDetail через /api/products/[slug].
 * - Внутри модалки работает add-to-cart → toast; ссылка «Перейти на страницу».
 * - Клик по кнопке Quick View НЕ триггерит навигацию на /product/[slug].
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.removeItem("bigmax:cart");
    } catch {
      /* noop */
    }
  });
});

test("Quick View: клик открывает модалку с деталями товара", async ({ page }) => {
  await page.goto("/ru");
  // На главной в «Рекомендуем» есть pampers-premium-care-3 — isFeatured=true
  // в seed'е, stock=40. Гарантированно in-stock, кнопка «В корзину» активна.

  // Находим карточку pampers и её Quick View-кнопку — детерминированно.
  // Первая featured-карточка на home (seed: mock-098-accessories, isFeatured=true,
  // stock > 0 т.к. 98 % 9 !== 0). Детерминированно.
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "Быстрый просмотр" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Внутри модалки ждём загрузку ProductDetail.
  await expect(dialog.getByRole("button", { name: "В корзину" })).toBeVisible({ timeout: 5_000 });

  // Ссылка на полную страницу.
  await expect(dialog.getByRole("link", { name: /Перейти на страницу товара/ })).toBeVisible();

  // Секция «Характеристики» с атрибутами (категория + бренд на минимум).
  await expect(dialog.getByRole("heading", { name: "Характеристики" })).toBeVisible();
  await expect(dialog.getByText("Категория", { exact: true })).toBeVisible();

  // URL не изменился — остаёмся на главной.
  await expect(page).toHaveURL(/\/ru$/);
});

test("Quick View: add-to-cart изнутри модалки → toast", async ({ page }) => {
  await page.goto("/ru");
  // pampers — isFeatured=true, stock=40, кнопка «В корзину» активна.
  // Первая featured-карточка на home (seed: mock-098-accessories, isFeatured=true,
  // stock > 0 т.к. 98 % 9 !== 0). Детерминированно.
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "Быстрый просмотр" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "В корзину" }).click();

  // Sonner-toast всплывает. Диалог остаётся открытым — юзер может закрыть
  // сам или продолжить с другим вариантом.
  await expect(page.getByText("Добавлено в корзину")).toBeVisible({ timeout: 3_000 });
});

test("Quick View: клик по overlay-кнопке не улетает на /product/[slug]", async ({ page }) => {
  await page.goto("/ru");
  // Первая featured-карточка на home (seed: mock-098-accessories, isFeatured=true,
  // stock > 0 т.к. 98 % 9 !== 0). Детерминированно.
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "Быстрый просмотр" }).click();

  // Остаёмся на главной, открыт диалог — не улетели на /product/[slug].
  await expect(page).toHaveURL(/\/ru$/);
  await expect(page.getByRole("dialog")).toBeVisible();
});
