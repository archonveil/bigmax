/**
 * P3-T2+Inline (scope-expansion): inline-«В корзину» + stepper [− qty +]
 * на карточке товара.
 *
 * Проверяем:
 *   - До добавления — кнопка «В корзину».
 *   - После клика — stepper с qty=1, Header-бейдж показывает «1».
 *   - «+» → qty=2, бейдж «2».
 *   - «−» дважды → позиция удаляется, кнопка возвращается, бейдж скрыт.
 *   - Клик по stepper'у не триггерит навигацию на /product/[slug].
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

test("Inline cart controls: кнопка → stepper → бейдж растёт", async ({ page }) => {
  await page.goto("/ru");
  // mock-098 — первая featured-карточка, isFeatured, stock > 0.
  const firstCard = page.locator("article").first();

  // До клика — кнопка «В корзину» присутствует.
  const addBtn = firstCard.getByRole("button", { name: "В корзину" });
  await expect(addBtn).toBeVisible();

  await addBtn.click();

  // Появляется stepper внутри той же карточки; кнопки + / −.
  const incBtn = firstCard.getByRole("button", { name: "Увеличить количество" });
  const decBtn = firstCard.getByRole("button", { name: "Уменьшить количество" });
  await expect(incBtn).toBeVisible();
  await expect(decBtn).toBeVisible();

  // Header-бейдж «1». Берём desktop-вариант CartButton (первая кнопка в DOM).
  const cartBtn = page.getByRole("button", { name: "Открыть корзину" }).first();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("1");

  // + → 2.
  await incBtn.click();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("2");

  // − дважды: 2 → 1 → удаление. Кнопка «В корзину» возвращается, бейдж пропадает.
  await decBtn.click();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("1");
  await decBtn.click();
  await expect(firstCard.getByRole("button", { name: "В корзину" })).toBeVisible();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveCount(0);
});

test("Inline cart controls: клики не улетают на /product/[slug]", async ({ page }) => {
  await page.goto("/ru");
  const firstCard = page.locator("article").first();

  await firstCard.getByRole("button", { name: "В корзину" }).click();
  // После клика мы всё ещё на главной.
  await expect(page).toHaveURL(/\/ru$/);

  await firstCard.getByRole("button", { name: "Увеличить количество" }).click();
  await expect(page).toHaveURL(/\/ru$/);
});
