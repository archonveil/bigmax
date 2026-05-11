/**
 * P2-T8: страница товара.
 * - Рендерит имя, галерею, варианты.
 * - Breadcrumb → категория.
 * - Неизвестный slug → 404.
 */

import { expect, test } from "@playwright/test";

test.describe("product page", () => {
  test("pampers-premium-care-3 рендерит карточку на ru", async ({ page }) => {
    await page.goto("/ru/product/pampers-premium-care-3");
    await expect(
      page.getByRole("heading", { name: /pampers premium care/i, level: 1 }),
    ).toBeVisible();
    // Бренд-хинт над заголовком.
    await expect(page.getByText(/pampers/i).first()).toBeVisible();
    // Галерея (как минимум 1 <img>).
    await expect(page.locator("img").first()).toBeVisible();
  });

  test("breadcrumb ведёт в родительскую категорию", async ({ page }) => {
    await page.goto("/ru/product/pampers-premium-care-3");
    const breadcrumb = page.locator("main nav").first();
    const catLink = breadcrumb.getByRole("link", { name: /подгузники/i });
    await expect(catLink).toBeVisible();
    await catLink.click();
    await expect(page).toHaveURL(/\/ru\/catalog\/diapers/);
  });

  test("неизвестный slug → 404", async ({ page }) => {
    const response = await page.goto("/ru/product/does-not-exist-xyz");
    expect(response?.status()).toBe(404);
  });
});
