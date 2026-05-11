/**
 * P3-T2+Inline (scope-extension): multi-variant chip-picker на карточке +
 * stock-cap на inc-кнопке.
 *
 * Ранее карточка добавляла только дефолтный вариант (самый дешёвый). Теперь:
 *   - многовариантный товар показывает чипы `color · size`;
 *   - клик по чипу выбирает вариант, stepper/кнопка действует на выбранный;
 *   - `+` disabled при qty >= stockQuantity.
 */

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:cart"));
});

test("multi-variant card: видны чипы цвет/размер", async ({ page }) => {
  // chicco-bodysuit-cotton: 2 варианта — 62/белый и 68/голубой.
  await page.goto("/ru/catalog/clothing");
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("link", { name: /chicco cotton bodysuit|chicco bodi|боди chicco/i }),
    })
    .first();

  // Чипы присутствуют.
  await expect(card.getByRole("button", { name: /белый/i, pressed: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /голубой/i })).toBeVisible();
});

test("multi-variant: переключение чипа меняет контекст add-to-cart + qty badge на чипе", async ({
  page,
}) => {
  await page.goto("/ru/catalog/clothing");
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("link", { name: /chicco cotton bodysuit|chicco bodi|боди chicco/i }),
    })
    .first();

  // Добавляем дефолтный (белый · 62).
  await card.getByRole("button", { name: "В корзину" }).click();
  // Теперь stepper видим для активного чипа (белый).
  await expect(card.getByRole("button", { name: "Увеличить количество" })).toBeVisible();

  // На чипе «белый» появился inline-бейдж с qty=1.
  const whiteChip = card.getByRole("button", { name: /белый/i });
  await expect(whiteChip.locator("span[aria-hidden]")).toHaveText("1");

  // Переключаем на голубой. Для него ещё не в корзине → показывается «В корзину»;
  // на чипе «голубой» бейджа нет.
  await card.getByRole("button", { name: /голубой/i }).click();
  await expect(card.getByRole("button", { name: "В корзину" })).toBeVisible();
  const blueChip = card.getByRole("button", { name: /голубой/i });
  await expect(blueChip.locator("span[aria-hidden]")).toHaveCount(0);

  // И Header-бейдж показывает «1» (один белый в корзине).
  const cartBtn = page.getByRole("button", { name: "Открыть корзину" }).first();
  await expect(cartBtn.locator("span[aria-hidden]")).toHaveText("1");
});

test("stock-cap: + disabled при quantity >= stockQuantity", async ({ page }) => {
  // mock-028-toys-educational — isFeatured=true, stockQuantity = 5 + (28*1)%40 = 33
  // (>99 не уйдёт, hard-cap 99 не триггерится). Нужен товар с маленьким stock.
  // chicco-projector: variants stock=8 и stock=6. Берём projector cards.
  await page.goto("/ru/product/chicco-first-dreams-projector");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // На продуктовой странице — есть VariantPicker, не stepper. Stock-cap там
  // не применяется как таковой (есть свои ограничения). Поэтому тестим через
  // карточку на категории (toys-educational).
  await page.goto("/ru/catalog/toys-educational");
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("link", { name: /first dreams|musical projector|музыкальный проектор/i }),
    })
    .first();

  // Добавляем (stockQuantity=8 для дефолтного розового).
  await card.getByRole("button", { name: "В корзину" }).click();

  // Нажимаем + 7 раз, доводим до 8.
  const incBtn = card.getByRole("button", { name: "Увеличить количество" });
  for (let i = 0; i < 7; i += 1) {
    await incBtn.click();
  }

  // Сейчас quantity=8, stockQuantity=8 → + disabled.
  await expect(incBtn).toBeDisabled();
});
