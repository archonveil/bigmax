/**
 * P3-T4: избранное для гостя.
 *
 * - `<FavoriteButton>` на карточке — toggle меняет state и показывает toast.
 * - `/favorites` пуст → empty-state с CTA в каталог.
 * - После toggle — позиция появляется на /favorites; remove из карточки убирает.
 * - /favorites имеет `robots: noindex`; robots.txt → Disallow.
 *
 * Sync-поведение (guest→user) не тестируем здесь — требует логина + БД.
 * Покрытие в P3-T6.
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:favorites"));
});

test("пустой /favorites показывает empty-state + CTA в каталог", async ({ page }) => {
  await page.goto("/ru/favorites");
  await expect(page.getByRole("heading", { name: "Избранное", level: 1 })).toBeVisible();
  await expect(page.getByText("В избранном пусто")).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти в каталог" })).toBeVisible();
});

test("FavoriteButton: toggle добавляет товар на /favorites", async ({ page }) => {
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "В избранное" }).click();
  // toast появляется
  await expect(page.getByText("Добавлено в избранное")).toBeVisible({ timeout: 3_000 });

  // На /favorites теперь есть карточка.
  await page.goto("/ru/favorites");
  await expect(page.getByRole("heading", { name: "Избранное", level: 1 })).toBeVisible();
  await expect(page.getByText(/Mock-товар/)).toBeVisible();
});

test("FavoriteButton: повторный клик удаляет товар", async ({ page }) => {
  const firstCard = page.locator("article").first();

  // Добавить
  await firstCard.getByRole("button", { name: "В избранное" }).click();
  // Кнопка меняет aria-label на «Убрать из избранного» (aria-pressed=true)
  await expect(firstCard.getByRole("button", { name: "Убрать из избранного" })).toBeVisible();

  // Убрать
  await firstCard.getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(firstCard.getByRole("button", { name: "В избранное" })).toBeVisible();

  // На /favorites теперь пусто
  await page.goto("/ru/favorites");
  await expect(page.getByText("В избранном пусто")).toBeVisible();
});

test("Удаление из карточки на /favorites через тот же heart-toggle", async ({ page }) => {
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "В избранное" }).click();

  await page.goto("/ru/favorites");
  await expect(page.getByText(/Mock-товар/)).toBeVisible();

  // `<FavoriteButton>` переиспользуется здесь (унифицированный UX):
  // на /favorites сердце активно (aria-label = «Убрать из избранного»).
  await page.getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(page.getByText("Удалено из избранного")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("В избранном пусто")).toBeVisible();
});

test("/favorites имеет meta robots noindex", async ({ page }) => {
  await page.goto("/ru/favorites");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("robots.txt содержит Disallow для favorites", async ({ request }) => {
  const r = await request.get("/robots.txt");
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).toMatch(/Disallow:\s*\/\*\/favorites/);
});
