/**
 * P2-T8: фильтры и сортировка на странице категории.
 * - URL-driven: применение фильтра обновляет querystring.
 * - «Сбросить» очищает все фильтры (регрессия URLSearchParams.forEach+delete).
 * - Переключение сортировки отражается в querystring.
 */

import { expect, test } from "@playwright/test";

test.describe("category filters", () => {
  test("применение и сброс фильтра по полу", async ({ page }) => {
    await page.goto("/ru/catalog/clothing");

    const gender = page.getByLabel("Пол");
    await gender.click();
    await page.getByRole("option", { name: "Мальчик" }).click();

    // URL получает ?gender=boy
    await expect(page).toHaveURL(/gender=boy/);

    // Появляется кнопка «Сбросить» (active filters hint).
    const reset = page.getByRole("button", { name: "Сбросить" });
    await expect(reset).toBeVisible();

    await reset.click();
    // URL возвращается на чистый — без gender, без brand, без page.
    await expect(page).toHaveURL(/\/ru\/catalog\/clothing(\?.*)?$/);
    await expect(page).not.toHaveURL(/gender=/);
  });
});

test.describe("category sort", () => {
  test("выбор newest кладёт sort=newest в URL", async ({ page }) => {
    await page.goto("/ru/catalog/clothing");
    // Radix Select trigger — `<button role="combobox">`. Сужаем до того,
    // что рядом с текстом «Сортировка» в header'е страницы.
    const sort = page.locator("div", { hasText: /^Сортировка/ }).getByRole("combobox");
    await sort.click();
    await page.getByRole("option", { name: "Новинки" }).click();
    await expect(page).toHaveURL(/sort=newest/);
  });

  test("дефолт (featured) не попадает в URL", async ({ page }) => {
    await page.goto("/ru/catalog/clothing?sort=newest");
    await expect(page).toHaveURL(/sort=newest/);

    const sort = page.locator("div", { hasText: /^Сортировка/ }).getByRole("combobox");
    await sort.click();
    await page.getByRole("option", { name: "Рекомендуемые" }).click();
    // Дефолт → удаляется из querystring.
    await expect(page).not.toHaveURL(/sort=/);
  });
});
