/**
 * P5-T1: e2e для `/account/orders` (история заказов с фильтрами + пагинацией).
 *
 * Сценарии:
 *   1. Гость → редирект на /auth/login (через layout).
 *   2. Empty-state без заказов.
 *   3. Список с заказами + правильный порядок (DESC по createdAt).
 *   4. Фильтр по статусу — показывает только matching.
 *   5. Empty-state «filtered» при фильтре без совпадений.
 *   6. Пагинация — page=2 ведёт на следующую страницу.
 *   7. Клик на карточку → переход на /orders/[id]/success.
 */

import { prisma, type OrderStatus } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-account-orders@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Account Orders",
};

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  // Уникальный seq в пределах теста: timestamp ms + counter. Скобки
  // `(Date.now() | 0)` обязательны — без них precedence `|` < `+` теряет
  // counter в OR'е с timestamp.
  const seq = String(((Date.now() | 0) + seedCounter) % 9999).padStart(4, "0");
  return `BGX-${yyyy}${mm}${dd}-${seq}-T1`;
}

interface SeedSpec {
  status: OrderStatus;
  totalCents: number;
  /** Сдвиг от now() в минутах назад — для контроля порядка DESC. */
  ageMin: number;
  paymentProvider?: "uniteller" | "cod" | "uzum";
}

async function seedOrders(specs: SeedSpec[]): Promise<{ id: string; number: string }[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });
  const created: { id: string; number: string }[] = [];
  for (const spec of specs) {
    const number = nextOrderNumber();
    const createdAt = new Date(Date.now() - spec.ageMin * 60_000);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        number,
        status: spec.status,
        locale: "ru",
        subtotalCents: spec.totalCents - 50_000_00,
        deliveryCostCents: 50_000_00,
        discountCents: 0,
        totalCents: spec.totalCents,
        currency: "UZS",
        deliveryMethod: "courier",
        createdAt,
      },
      select: { id: true, number: true },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: spec.paymentProvider ?? "cod",
        status: spec.status === "cancelled" ? "cancelled" : "pending",
        amountCents: spec.totalCents,
        currency: "UZS",
      },
    });
    created.push(order);
  }
  return created;
}

async function login(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P5-T1 · /account/orders", () => {
  test.beforeEach(async () => {
    await createTestUser(USER);
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("гость → редирект на /auth/login", async ({ page }) => {
    await page.goto("/ru/account/orders");
    await page.waitForURL(/\/ru\/auth\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/auth/login");
  });

  test("без заказов → empty-state «No orders yet»", async ({ page }) => {
    await login(page);
    await page.goto("/ru/account/orders");
    await expect(page.getByTestId("orders-empty")).toBeVisible();
    await expect(page.getByText(/Заказов пока нет/)).toBeVisible();
    await expect(page.getByTestId("orders-pagination")).toHaveCount(0);
  });

  test("3 заказа → DESC по createdAt + правильные итоги", async ({ page }) => {
    const orders = await seedOrders([
      { status: "pending", totalCents: 100_000_00, ageMin: 60 }, // older
      { status: "delivered", totalCents: 250_000_00, ageMin: 30 }, // middle
      { status: "confirmed", totalCents: 75_000_00, ageMin: 10 }, // newest
    ]);
    await login(page);
    await page.goto("/ru/account/orders");

    const items = page.getByTestId("orders-list").locator("li");
    await expect(items).toHaveCount(3);

    // Newest first → confirmed (75k), delivered (250k), pending (100k)
    await expect(items.nth(0)).toContainText(orders[2]!.number);
    await expect(items.nth(0)).toContainText("Подтверждён");
    await expect(items.nth(1)).toContainText(orders[1]!.number);
    await expect(items.nth(1)).toContainText("Доставлен");
    await expect(items.nth(2)).toContainText(orders[0]!.number);
    await expect(items.nth(2)).toContainText("Ожидает оплаты");

    // Summary count
    await expect(page.getByText(/3 заказа|3 заказов/)).toBeVisible();
  });

  test("фильтр ?status=delivered → только delivered", async ({ page }) => {
    const orders = await seedOrders([
      { status: "pending", totalCents: 100_000_00, ageMin: 60 },
      { status: "delivered", totalCents: 250_000_00, ageMin: 30 },
      { status: "confirmed", totalCents: 75_000_00, ageMin: 10 },
    ]);
    await login(page);
    await page.goto("/ru/account/orders?status=delivered");

    const items = page.getByTestId("orders-list").locator("li");
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText(orders[1]!.number);
    await expect(items.nth(0)).toContainText("Доставлен");
  });

  test("фильтр без совпадений → empty-filtered state", async ({ page }) => {
    await seedOrders([{ status: "pending", totalCents: 50_000_00, ageMin: 5 }]);
    await login(page);
    await page.goto("/ru/account/orders?status=refunded");
    await expect(page.getByTestId("orders-empty-filtered")).toBeVisible();
    await expect(page.getByTestId("orders-empty")).toHaveCount(0);
  });

  test("пагинация: 12 заказов → page 1 (10 шт.) + ссылка на page 2 (2 шт.)", async ({ page }) => {
    // Seed 12 orders с возрастающим ageMin — гарантирует стабильный DESC порядок.
    const specs: SeedSpec[] = Array.from({ length: 12 }, (_, i) => ({
      status: "pending" as const,
      totalCents: (i + 1) * 1_000_00,
      ageMin: i + 1,
    }));
    await seedOrders(specs);
    await login(page);
    await page.goto("/ru/account/orders");

    await expect(page.getByTestId("orders-list").locator("li")).toHaveCount(10);
    const pagination = page.getByTestId("orders-pagination");
    await expect(pagination).toBeVisible();
    await expect(pagination).toContainText(/Страница 1 из 2/);

    await pagination.getByRole("link", { name: /Вперёд/ }).click();
    await page.waitForURL(/\?page=2/, { timeout: 5_000 });
    await expect(page.getByTestId("orders-list").locator("li")).toHaveCount(2);
    await expect(pagination).toContainText(/Страница 2 из 2/);
  });

  test("клик на карточку → /account/orders/[id] (детальная P5-T2)", async ({ page }) => {
    const [order] = await seedOrders([{ status: "confirmed", totalCents: 75_000_00, ageMin: 5 }]);
    await login(page);
    await page.goto("/ru/account/orders");
    await page.getByTestId("orders-list").locator("li").first().click();
    await page.waitForURL(new RegExp(`/ru/account/orders/${order!.id}$`), { timeout: 10_000 });
    expect(page.url()).toContain(`/account/orders/${order!.id}`);
  });
});
