/**
 * P4-T3: выбор филиала для самовывоза. Проверяем UX «карточки + карта»:
 *   - При method=pickup список из 3 филиалов (seed) рендерится как radiogroup.
 *   - Клик по карточке меняет aria-checked, branchId уходит в next-шаг.
 *   - Leaflet-карта инициализируется (контейнер + тайлы OSM).
 *   - Review показывает адрес, телефон и часы работы выбранного филиала.
 */

import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:checkout-draft");
  });
});

async function goToDeliveryStep(page: Page): Promise<void> {
  await page.goto("/ru/product/nuby-cherry-pacifier");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/ru/checkout");

  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("ул.");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
}

test("pickup: BranchPicker рендерится с 3 филиалами и картой", async ({ page }) => {
  await goToDeliveryStep(page);
  await page.getByText("Самовывоз из филиала").click();

  // 3 карточки филиалов внутри radiogroup (метод доставки — отдельные radio'ы).
  const picker = page.getByRole("radiogroup", { name: /филиал/i });
  await expect(picker.getByRole("radio")).toHaveCount(3);
  await expect(page.getByText("Ташкент — Центр")).toBeVisible();
  await expect(page.getByText("Ташкент — Юнусабад")).toBeVisible();
  await expect(page.getByText("Ташкент — Чиланзар")).toBeVisible();

  // Leaflet: контейнер с классом и попытка подгрузить OSM-тайлы.
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-tile-pane img").first()).toBeVisible({ timeout: 10_000 });
});

test("pickup: клик по карточке меняет aria-checked и проваливает выбор в Review", async ({
  page,
}) => {
  await goToDeliveryStep(page);
  await page.getByText("Самовывоз из филиала").click();

  // Кликаем на Чиланзарский филиал.
  const chilonzorCard = page.getByRole("radio", { name: /Чиланзар/ });
  await chilonzorCard.click();
  await expect(chilonzorCard).toHaveAttribute("aria-checked", "true");

  // Идём до Review.
  await page.getByRole("button", { name: /^Далее$/ }).click();
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  // Review-карточка «Способ доставки» содержит имя, адрес и телефон выбранного филиала.
  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
  const card = page.locator("article").filter({ hasText: "Способ доставки" });
  await expect(card).toContainText("Ташкент — Чиланзар");
  await expect(card).toContainText(/Бунёдкор/);
  await expect(card).toContainText("+998712333344");
});

test("pickup: submit без выбора филиала оставляет на том же шаге", async ({ page }) => {
  await goToDeliveryStep(page);
  await page.getByText("Самовывоз из филиала").click();

  // Submit без клика по картам — branchId="" → refine в DeliveryStepSchema должен провалить.
  await page.getByRole("button", { name: /^Далее$/ }).click();
  await expect(page.getByRole("heading", { name: "Способ доставки" })).toBeVisible();
  await expect(page.getByText("Выберите филиал").first()).toBeVisible();
});
