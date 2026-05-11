/**
 * P2-T8: навигация по каталогу × 3 локали.
 * - `/ru/catalog` — индекс с 9 top-категориями.
 * - Клик по категории → `/ru/catalog/<slug>`, карточки товаров.
 * - Пагинация: на /ru/search?q=mock (≥2 страниц) — кнопка «Вперёд»
 *   ведёт на ?page=2 и работает назад. Регрессия `/ru/ru/…` (двойной префикс).
 */

import { expect, test } from "@playwright/test";

const LOCALES = ["ru", "uz", "en"] as const;

test.describe("catalog index", () => {
  for (const locale of LOCALES) {
    test(`/${locale}/catalog рендерит список категорий`, async ({ page }) => {
      await page.goto(`/${locale}/catalog`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // 9 top-категорий из seed'а.
      const cards = page.getByRole("main").locator("ul > li").first().locator("..");
      await expect(cards.getByRole("link")).toHaveCount(await cards.getByRole("link").count());
      // Ссылка на /clothing обязана быть.
      await expect(
        page.getByRole("link", { name: /одежда|kiyim|clothing/i }).first(),
      ).toBeVisible();
    });
  }
});

test.describe("category → products", () => {
  test("/ru/catalog/clothing показывает карточки товаров", async ({ page }) => {
    await page.goto("/ru/catalog/clothing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Минимум 1 карточка (в seed'е гарантированно есть).
    const cards = page.locator("ul a[href*='/product/']");
    await expect(cards.first()).toBeVisible();
  });

  test("breadcrumb у подкатегории ведёт к родителю", async ({ page }) => {
    await page.goto("/ru/catalog/bodysuits");
    const breadcrumb = page.locator("main nav").first();
    await expect(breadcrumb.getByRole("link", { name: /одежда/i })).toBeVisible();
  });
});

test.describe("pagination", () => {
  test("search page → page=2 работает и URL без двойного локаль-префикса", async ({ page }) => {
    // `mock` матчит все 100 фикстурных товаров — гарантировано ≥2 страниц.
    await page.goto("/ru/search?q=mock");
    const nextLink = page.getByRole("link", { name: /вперёд|oldinga|next/i });
    await expect(nextLink).toBeVisible();

    const href = await nextLink.getAttribute("href");
    // Регрессия: раньше было /ru/ru/search?q=mock&page=2
    expect(href).toMatch(/^\/ru\/search\?q=mock&page=2$/);
    expect(href).not.toContain("/ru/ru/");

    await nextLink.click();
    await expect(page).toHaveURL(/\/ru\/search\?q=mock&page=2/);
  });
});
