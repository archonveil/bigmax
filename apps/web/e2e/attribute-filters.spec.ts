/**
 * Category-specific attribute filters (scope extension).
 *
 * Проверяем что:
 *   - Сайдбар отображает поле характерное для категории (Diapers →
 *     «Размер подгузника», Food → «Объём» + «Органический»).
 *   - Enum-фильтр режет результаты (pampers остаётся, mock'ов без этого
 *     размера нет).
 *   - Bool-фильтр режет результаты (hipp остаётся, прочие нет).
 *   - «Сбросить» убирает attr.* из URL.
 */

import { expect, test } from "@playwright/test";

test("diapers category: «Размер подгузника» фильтр показывает только мэтч", async ({ page }) => {
  await page.goto("/ru/catalog/diapers");

  // До фильтра — 8 карточек (pampers + 7 mock'ов в diapers).
  const articles = page.locator("article");
  await expect(articles.first()).toBeVisible();
  const before = await articles.count();
  expect(before).toBeGreaterThan(1);

  // Select «Размер подгузника» → 3.
  const sizeTrigger = page.getByLabel("Размер подгузника");
  await sizeTrigger.click();
  await page.getByRole("option", { name: "3 (Midi)" }).click();

  await expect(page).toHaveURL(/attr\.diaperSize=3/);
  // Только pampers остался.
  await expect(page.getByText(/pampers premium care/i)).toBeVisible();
  const after = await articles.count();
  expect(after).toBeLessThan(before);
});

test("food category: «Органический» boolean-фильтр → остаётся только hipp", async ({ page }) => {
  await page.goto("/ru/catalog/food");
  const articles = page.locator("article");
  const before = await articles.count();

  // Checkbox «Органический» — в сайдбаре.
  await page.getByRole("checkbox", { name: "Органический" }).click();

  await expect(page).toHaveURL(/attr\.isOrganic=true/);
  await expect(page.getByText(/hipp/i).first()).toBeVisible();
  const after = await articles.count();
  expect(after).toBeLessThan(before);
});

test("Сбросить убирает attr.* из URL", async ({ page }) => {
  await page.goto("/ru/catalog/food?attr.isOrganic=true");
  await expect(page).toHaveURL(/attr\.isOrganic=true/);

  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page).not.toHaveURL(/attr\./);
});
