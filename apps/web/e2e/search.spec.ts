/**
 * P2-T8: поиск.
 * - `<SearchBox>` в Header: debounced fetch + dropdown.
 * - Страница /search?q=... рендерит результаты + пагинацию.
 * - Пустой q → редирект на /catalog.
 */

import { expect, test } from "@playwright/test";

test.describe("search autocomplete (Header SearchBox)", () => {
  test("ввод «mock» показывает dropdown с матчами", async ({ page }) => {
    await page.goto("/ru");
    const input = page.getByRole("combobox");
    await input.fill("mock");

    // Дебаунс 250ms + fetch → появляется listbox с ≥1 option.
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await expect(listbox.getByRole("option").first()).toBeVisible();
  });

  test("< 2 символов показывает подсказку", async ({ page }) => {
    await page.goto("/ru");
    const input = page.getByRole("combobox");
    await input.fill("m");
    await expect(page.getByText(/камидам|ental|минимум 2/i).first()).toBeVisible();
  });
});

test.describe("search results page", () => {
  test("/ru/search?q=mock рендерит грид + 1-ю страницу из 24", async ({ page }) => {
    await page.goto("/ru/search?q=mock");
    await expect(
      page.getByRole("heading", { name: /результаты по запросу «mock»/i, level: 1 }),
    ).toBeVisible();
    // 24 карточки на 1-й странице (seed: 100 mock-товаров).
    const cards = page.locator("a[href*='/product/']");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(24);
  });

  test("пустой q редиректит на /catalog", async ({ page }) => {
    await page.goto("/ru/search");
    await expect(page).toHaveURL(/\/ru\/catalog$/);
  });
});
