/**
 * P3-T2 sub-tasks (A/B/C): проверяем что
 *   - add-to-cart показывает Sonner-toast (а не открывает Sheet автоматически),
 *   - клик по иконке корзины открывает Sheet с позицией,
 *   - inc/dec/remove работают, счётчик-бейдж отражает total qty,
 *   - SearchBox dropdown и Sheet overlay не перехватывают друг друга.
 *
 * Перед тестом чистим localStorage (корзина персистится в `bigmax:cart`).
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.removeItem("bigmax:cart");
    } catch {
      /* private-mode safety */
    }
  });
});

test("add-to-cart: клик по «В корзину» → toast, Sheet НЕ открывается автоматически", async ({
  page,
}) => {
  await page.goto("/ru/product/pampers-premium-care-3");

  const addBtn = page.getByRole("button", { name: "В корзину" });
  await addBtn.click();

  // Toast с «Добавлено в корзину» появляется и содержит action «Открыть корзину».
  const toast = page.getByText("Добавлено в корзину");
  await expect(toast).toBeVisible({ timeout: 3_000 });

  // Sheet НЕ открылся автоматически (dialog с role="dialog" отсутствует).
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cart-flow: клик по иконке корзины → Sheet с позицией, inc/dec/remove", async ({ page }) => {
  await page.goto("/ru/product/pampers-premium-care-3");
  await page.getByRole("button", { name: "В корзину" }).click();

  // Ждём, пока toast всплывёт (признак что add() применился и persist записал).
  await expect(page.getByText("Добавлено в корзину")).toBeVisible({ timeout: 3_000 });

  // Открываем Sheet через Header-кнопку (desktop-версию, она первая в DOM
  // для desktop-проекта; на mobile-chrome проектa та же кнопка в мобильном nav).
  await page.getByRole("button", { name: "Открыть корзину" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Корзина" })).toBeVisible();

  // Позиция в корзине — 1 шт.
  const qty = dialog.locator("span.tabular-nums").first();
  await expect(qty).toHaveText("1");

  // inc → 2.
  await dialog.getByRole("button", { name: "Увеличить количество" }).click();
  await expect(qty).toHaveText("2");

  // dec → 1.
  await dialog.getByRole("button", { name: "Уменьшить количество" }).click();
  await expect(qty).toHaveText("1");

  // remove → empty state.
  await dialog.getByRole("button", { name: "Удалить" }).click();
  await expect(dialog.getByText("Корзина пуста")).toBeVisible();
});

test("counter badge на CartButton отражает total qty + cap 9+", async ({ page }) => {
  await page.goto("/ru/product/pampers-premium-care-3");
  // Первый клик «В корзину» → позиция добавлена, кнопка превратилась в stepper.
  await page.getByRole("button", { name: "В корзину" }).click();
  await expect(page.getByText("Добавлено в корзину")).toBeVisible();

  // Бейдж показывает "1".
  const cartBtn = page.getByRole("button", { name: "Открыть корзину" }).first();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("1");

  // «+» в stepper'е поднимает qty до 10 → бейдж капится на «9+».
  const incBtn = page.getByRole("button", { name: "Увеличить количество" }).first();
  for (let i = 0; i < 9; i += 1) {
    await incBtn.click();
  }
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("9+");
});

test("SearchBox dropdown и Sheet overlay не конфликтуют", async ({ page }) => {
  await page.goto("/ru");

  // Открываем SearchBox dropdown.
  const search = page.getByRole("combobox").first();
  await search.fill("mock");
  await expect(page.getByRole("listbox")).toBeVisible();

  // Клик по CartButton — dropdown закрывается (outside-click хэндлер),
  // Sheet открывается. Оба независимых state'а работают корректно.
  await page.getByRole("button", { name: "Открыть корзину" }).first().click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
