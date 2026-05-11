/**
 * P4-T10: проверяем контракт enqueue notifications после COD-чекаута.
 * Полный chain (enqueue → worker → Notification row → SMS/Telegram/Email)
 * валидируется в P4-T12 (mock-server e2e + worker spawn). Здесь же —
 * только что web-route запушил job в BullMQ-очередь `notifications`.
 *
 * Skip-логика: если REDIS_URL не задан → describe пропускается.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import { createTestUser, deleteTestUser } from "./helpers/user";

const REDIS_URL = process.env["REDIS_URL"];

const USER = {
  email: "e2e-notifications@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Notifications",
};

test.skip(!REDIS_URL, "REDIS_URL not set; skipping enqueue contract test");

test.describe("P4-T10 · enqueue notifications", () => {
  let connection: IORedis;
  let queue: Queue;

  test.beforeAll(() => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue("notifications", { connection });
  });

  test.afterAll(async () => {
    // Дренаж — чтоб не накапливалось от тестов между прогонами.
    await queue.drain();
    await queue.close();
    await connection.quit().catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/ru");
    await page.evaluate(() => {
      localStorage.removeItem("bigmax:cart");
      localStorage.removeItem("bigmax:checkout-draft");
    });
    await createTestUser(USER);
    await page.goto("/ru/auth/login");
    await page.locator("input#email").fill(USER.email);
    await page.locator("input#password").fill(USER.password);
    await page.getByRole("button", { name: /^Войти$/ }).click();
    await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
    await queue.drain();
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("COD-чекаут → BullMQ job order_created в очереди notifications", async ({ page }) => {
    // Снимок счётчика jobs до чекаута.
    const counts = await queue.getJobCounts("waiting", "delayed", "active");
    const before = counts.waiting + counts.delayed + counts.active;

    await fillCheckoutToReviewWithCod(page);
    await page.getByRole("button", { name: /Оформить заказ/ }).click();
    await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 10_000 });

    const url = page.url();
    const orderId = /\/orders\/([^/]+)\/success/.exec(url)?.[1];
    expect(orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId! },
      select: { number: true },
    });

    // Дожидаемся появления job (web fire-and-forget'ит, но это занимает мс).
    let foundJob: {
      name: string;
      data: { recipient: { userId: string }; payload: { orderNumber: string } };
    } | null = null;
    for (let i = 0; i < 20; i += 1) {
      const jobs = await queue.getJobs(["waiting", "delayed", "active"]);
      const match = jobs.find((j) => {
        const data = j.data as { payload?: { orderNumber?: string } };
        return data.payload?.orderNumber === order.number;
      });
      if (match) {
        foundJob = match as never;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(foundJob).not.toBeNull();
    expect(foundJob!.name).toBe("order_created");
    expect(foundJob!.data.payload.orderNumber).toBe(order.number);
    void before; // smoke — сравнение before/after лишнее, ищем по orderNumber
  });
});

async function fillCheckoutToReviewWithCod(page: Page): Promise<void> {
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
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();
  await page.getByRole("button", { name: /^Далее$/ }).click(); // delivery
  await expect(page.getByRole("heading", { name: "Способ оплаты" })).toBeVisible();
  await page.getByText("При получении").first().click();
  await page.getByRole("button", { name: /^Далее$/ }).click();
  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
}
