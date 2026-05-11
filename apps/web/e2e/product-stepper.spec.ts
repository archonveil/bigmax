/**
 * Stepper [− qty +] в `<VariantPicker>` на продуктовой странице и в Quick View.
 * Раньше была только кнопка «В корзину». Теперь — после add заменяется на
 * stepper с стоккапом (qty >= variant.stockQuantity → + disabled).
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:cart"));
});

test("product page: «В корзину» → stepper + inc/dec работают", async ({ page }) => {
  await page.goto("/ru/product/pampers-premium-care-3");

  // Изначально видна кнопка «В корзину».
  const addBtn = page.getByRole("button", { name: "В корзину" });
  await expect(addBtn).toBeVisible();

  await addBtn.click();
  // Toast.
  await expect(page.getByText("Добавлено в корзину")).toBeVisible({ timeout: 3_000 });

  // Stepper появился на месте кнопки «В корзину».
  const incBtn = page.getByRole("button", { name: "Увеличить количество" }).first();
  const decBtn = page.getByRole("button", { name: "Уменьшить количество" }).first();
  await expect(incBtn).toBeVisible();
  await expect(decBtn).toBeVisible();

  // Inc → qty=2.
  await incBtn.click();
  // Dec → qty=1.
  await decBtn.click();
  // Dec ещё раз → удаляет позицию, возвращается «В корзину».
  await decBtn.click();
  await expect(page.getByRole("button", { name: "В корзину" })).toBeVisible();
});

test("product page: переключение варианта меняет контекст stepper'а", async ({ page }) => {
  // chicco-bodysuit-cotton — 2 варианта (62/белый и 68/голубой).
  await page.goto("/ru/product/chicco-bodysuit-cotton");

  // Добавляем дефолтный (62).
  await page.getByRole("button", { name: "В корзину" }).click();
  await expect(page.getByRole("button", { name: "Увеличить количество" }).first()).toBeVisible();

  // Переключаем на 68 — для него ещё не в корзине → «В корзину» снова.
  await page.getByRole("button", { name: /68/ }).click();
  await expect(page.getByRole("button", { name: "В корзину" })).toBeVisible();

  // Переключение назад на 62 — снова stepper (qty=1).
  await page.getByRole("button", { name: /62/ }).click();
  await expect(page.getByRole("button", { name: "Увеличить количество" }).first()).toBeVisible();
});

test("Quick View: add → stepper внутри модалки", async ({ page }) => {
  await page.goto("/ru");
  // Первый featured card (mock-098, stock>0).
  const firstCard = page.locator("article").first();
  await firstCard.getByRole("button", { name: "Быстрый просмотр" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Внутри dialog'а — кнопка «В корзину». Click → stepper.
  const dialogAddBtn = dialog.getByRole("button", { name: "В корзину" });
  await dialogAddBtn.click();

  // Stepper в диалоге.
  await expect(dialog.getByRole("button", { name: "Увеличить количество" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Уменьшить количество" })).toBeVisible();
});
