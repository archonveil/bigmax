/**
 * P4-T2: калькулятор стоимости доставки — проверяем что `estimateDelivery`
 * из @bigmax/shared-types корректно пробрасывается в OrderSummary,
 * StepDelivery (карточка предпросмотра) и StepReview.
 *
 * Сценарии (5 сценариев × 2 projects = 10 тестов):
 *   1. Ближний регион (Андижан) → 50 000 сум в summary + preview.
 *   2. Ташкент центр (Мирабадский) → 15 000 сум.
 *   3. Ташкент без district → подсказка «Укажите район Ташкента».
 *   4. Самовывоз → «Бесплатно» + «Забрать можно в тот же день».
 *   5. Review: доставка выводится с ценой и ETA.
 */

import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:checkout-draft");
  });
});

// Кладём в корзину детерминированный дешёвый товар (25 000 сум) —
// subtotal должен быть НИЖЕ FREE_SHIPPING_THRESHOLD (500 000 сум),
// иначе расчёт вернёт «Бесплатно» и поломает ассерты на конкретные тарифы.
async function seedCartAndStartCheckout(page: Page): Promise<void> {
  await page.goto("/ru/product/nuby-cherry-pacifier");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/ru/checkout");

  // Contacts.
  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();
}

/** OrderSummary sticky aside → ищем строку "Доставка" + её значение. */
function deliveryRowValue(page: Page) {
  return page
    .locator("aside dl")
    .first()
    .getByText(/^Доставка$/)
    .locator("+ dd");
}

test("OrderSummary: Андижан → 50 000 сум в строке «Доставка»", async ({ page }) => {
  await seedCartAndStartCheckout(page);

  // Address — Андижан.
  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // На шаге Delivery — summary слева показывает 50 000 сум.
  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await expect(deliveryRowValue(page)).toHaveText(/50[\s  ]000/);

  // Preview-карточка доставки в StepDelivery тоже показывает цену + ETA.
  const preview = page.getByTestId("delivery-estimate-preview");
  await expect(preview).toContainText(/50[\s  ]000/);
  await expect(preview).toContainText(/2–4 дн\./);
});

test("OrderSummary: Ташкент + Мирабадский (центр) → 15 000 сум", async ({ page }) => {
  await seedCartAndStartCheckout(page);

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Ташкент", exact: true }).click();
  await page.getByLabel("Город").fill("Ташкент");
  // District: в Ташкенте — Мирабадский (центр-зона). Для tashkent-city
  // форма показывает селект вместо свободного Input.
  await page.getByLabel("Район").click();
  await page.getByRole("option", { name: "Мирабадский", exact: true }).click();
  await page.getByLabel("Улица").fill("Навои");
  await page.getByLabel("Дом").fill("10");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await expect(deliveryRowValue(page)).toHaveText(/15[\s  ]000/);
});

test("OrderSummary: Ташкент без района → подсказка «Укажите район Ташкента»", async ({ page }) => {
  await seedCartAndStartCheckout(page);

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Ташкент", exact: true }).click();
  await page.getByLabel("Город").fill("Ташкент");
  // District оставляем пустым.
  await page.getByLabel("Улица").fill("Навои");
  await page.getByLabel("Дом").fill("10");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await expect(deliveryRowValue(page)).toHaveText("Укажите район Ташкента");
});

test("OrderSummary: pickup → «Бесплатно»", async ({ page }) => {
  await seedCartAndStartCheckout(page);

  // Минимальный адрес — хоть он для pickup не обязателен, но форма требует street+house.
  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("ул.");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Переключаемся на pickup.
  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await page.getByText("Самовывоз из филиала").click();

  // Summary → «Бесплатно».
  await expect(deliveryRowValue(page)).toHaveText("Бесплатно");
  // Preview-карточка → «Бесплатно» + «Забрать можно в тот же день».
  const preview = page.getByTestId("delivery-estimate-preview");
  await expect(preview).toContainText("Бесплатно");
  await expect(preview).toContainText("Забрать можно в тот же день");
});

test("Review: строка доставки показывает цену + ETA", async ({ page }) => {
  await seedCartAndStartCheckout(page);

  // Ближний регион — Самарканд.
  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Самарканд", exact: true }).click();
  await page.getByLabel("Город").fill("Самарканд");
  await page.getByLabel("Улица").fill("Регистан");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Delivery → next.
  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await page.getByRole("button", { name: /^Далее$/ }).click();
  // Payment → next.
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Review card «Способ доставки» содержит "50 000" + "2–4 дн.".
  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
  const card = page.locator("article").filter({ hasText: "Способ доставки" });
  await expect(card).toContainText(/50[\s  ]000/);
  await expect(card).toContainText(/2–4 дн\./);
});
