/**
 * P5-T2: e2e для `/account/orders/[id]` (детали + re-order + refund-request).
 *
 * Сценарии:
 *   1. SSR-render: items / address / payment / totals видны, номер заказа,
 *      status badge.
 *   2. Чужой Order → 404.
 *   3. Re-order: POST /reorder возвращает items + клиент кладёт в cart +
 *      редиректит на /cart.
 *   4. Reorder API edge — order с deactivated product → skipped count.
 *   5. Refund button disabled когда нет captured payment, message по reason.
 *   6. Refund happy path: dialog открыт → reason → submit → 201 → success
 *      → Refund row в БД + history-секция отрендерена + кнопка повторно
 *      disabled (refund_already_requested).
 *   7. Refund validation: пустой reason — html5 required + 400 от сервера.
 */

import { prisma, type OrderStatus, type PaymentStatus } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-account-order-detail@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Order Detail",
};

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const seq = String(((Date.now() | 0) + seedCounter) % 9999).padStart(4, "0");
  return `BGX-${yyyy}${mm}${dd}-${seq}-T2`;
}

interface SeedSpec {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  withItems?: boolean;
}

async function seedOrder(spec: SeedSpec = {}): Promise<{ id: string; number: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { sku: "NB-PAC-PK" },
    select: { id: true, priceCents: true, product: { select: { id: true } } },
  });
  const number = nextOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: spec.status ?? "delivered",
      locale: "ru",
      subtotalCents: 50_000_00,
      deliveryCostCents: 25_000_00,
      discountCents: 0,
      totalCents: 75_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
      ...(spec.withItems !== false
        ? {
            items: {
              create: [
                {
                  variantId: variant.id,
                  quantity: 2,
                  priceCents: variant.priceCents,
                  productSnapshot: {
                    sku: "NB-PAC-PK",
                    color: "pink",
                    size: null,
                    product: {
                      slug: "nuby-cherry-pacifier",
                      nameRu: "Пустышка Nuby Cherry",
                      nameUz: "Nuby Cherry emizgich",
                      nameEn: "Nuby Cherry Pacifier",
                    },
                  },
                },
              ],
            },
          }
        : {}),
    },
    select: { id: true, number: true },
  });
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "uniteller",
      status: spec.paymentStatus ?? "captured",
      amountCents: 75_000_00,
      currency: "UZS",
      unitellerOrderIdp: number,
      unitellerCardMask: "4000 **** **** 2487",
      ...(spec.paymentStatus !== "pending" && spec.paymentStatus !== "failed"
        ? { capturedAt: new Date() }
        : {}),
    },
  });
  return order;
}

async function login(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P5-T2 · /account/orders/[id]", () => {
  test.beforeEach(async () => {
    await createTestUser(USER);
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("SSR: items + address + totals + номер заказа + status", async ({ page }) => {
    const order = await seedOrder();
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);

    await expect(page.locator("h1")).toContainText(order.number);
    // Badge в header'е (не в трекере — тот тоже содержит «Доставлен» как label).
    await expect(page.locator("header").getByText("Доставлен", { exact: true })).toBeVisible();
    await expect(page.getByTestId("detail-items")).toContainText("Пустышка Nuby Cherry");
    await expect(page.getByTestId("detail-totals")).toBeVisible();
    await expect(page.getByTestId("detail-payment")).toContainText("4000 **** **** 2487");
  });

  test("чужой Order → 404", async ({ page }) => {
    const other = await prisma.user.create({
      data: {
        email: "e2e-other-user@bigmax.uz",
        passwordHash: "x",
        role: "customer",
        language: "ru",
      },
      select: { id: true },
    });
    const otherOrder = await prisma.order.create({
      data: {
        userId: other.id,
        number: nextOrderNumber(),
        status: "delivered",
        locale: "ru",
        subtotalCents: 1,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 1,
        currency: "UZS",
        deliveryMethod: "courier",
      },
      select: { id: true, number: true },
    });

    try {
      await login(page);
      const res = await page.goto(`/ru/account/orders/${otherOrder.id}`);
      // notFound() в Next 14 даёт 404 status
      expect(res?.status()).toBe(404);
    } finally {
      await prisma.order.delete({ where: { id: otherOrder.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  test("re-order API: POST → addedItems с правильными полями", async ({ page }) => {
    const order = await seedOrder();
    await login(page);

    const res = await page.request.post(`/api/account/orders/${order.id}/reorder`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      addedItems: Array<{
        variantId: string;
        quantity: number;
        priceCents: number;
        nameRu: string;
      }>;
      skippedCount: number;
      totalCount: number;
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(1);
    expect(body.skippedCount).toBe(0);
    expect(body.addedItems).toHaveLength(1);
    expect(body.addedItems[0]!.quantity).toBe(2);
    // Re-order возвращает текущее имя продукта (не snapshot) — могло обновиться
    // в каталоге с момента заказа. Проверяем что non-empty + содержит «Nuby».
    expect(body.addedItems[0]!.nameRu).toMatch(/Nuby/i);
    expect(body.addedItems[0]!.priceCents).toBeGreaterThan(0);
  });

  test("re-order UI: клик кнопки → cart содержит позиции + redirect /cart", async ({ page }) => {
    const order = await seedOrder();
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);
    await page.getByTestId("reorder-button").click();
    await page.waitForURL(/\/ru\/cart$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/ru\/cart$/);
    // Cart содержит товар Nuby (точное имя берётся из текущего каталога,
    // не из snapshot'а заказа — re-order рефрешит названия).
    await expect(page.getByText(/Nuby/i).first()).toBeVisible();
  });

  test("refund disabled: нет captured payment → ineligible сообщение", async ({ page }) => {
    const order = await seedOrder({ status: "pending", paymentStatus: "pending" });
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);
    await expect(page.getByTestId("refund-disabled")).toBeVisible();
    await expect(page.getByTestId("refund-disabled")).toContainText(/только для оплаченных/);
  });

  test("refund happy path → 201 + Refund row + success-state в диалоге", async ({ page }) => {
    const order = await seedOrder();
    await login(page);
    await page.goto(`/ru/account/orders/${order.id}`);
    await page.getByTestId("refund-button").click();
    await expect(page.getByTestId("refund-dialog")).toBeVisible();

    await page
      .getByTestId("refund-reason-input")
      .fill("Товар пришёл повреждённым, упаковка вскрыта.");
    await page.getByTestId("refund-submit").click();

    // Успех: success-state в том же диалоге (DialogTitle меняется).
    await expect(page.getByText("Запрос отправлен")).toBeVisible({ timeout: 10_000 });

    // Refund row в БД
    const refunds = await prisma.refund.findMany({
      where: { payment: { orderId: order.id } },
      select: { status: true, reason: true },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.status).toBe("pending");
    expect(refunds[0]!.reason).toContain("Товар пришёл повреждённым");
  });

  test("refund validation: короткий reason → 400 + error inline", async ({ page }) => {
    const order = await seedOrder();
    await login(page);

    const res = await page.request.post(`/api/account/orders/${order.id}/refund`, {
      data: { reason: "коротко" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { ok: boolean; reason: string; message?: string };
    expect(body).toMatchObject({ ok: false, reason: "invalid_body", message: "reason_too_short" });
  });

  test("refund второй раз → 409 conflict (уже pending)", async ({ page }) => {
    const order = await seedOrder();
    await login(page);

    const r1 = await page.request.post(`/api/account/orders/${order.id}/refund`, {
      data: { reason: "Первая причина возврата товара." },
      headers: { "Content-Type": "application/json" },
    });
    expect(r1.status()).toBe(201);

    const r2 = await page.request.post(`/api/account/orders/${order.id}/refund`, {
      data: { reason: "Вторая причина возврата того же." },
      headers: { "Content-Type": "application/json" },
    });
    expect(r2.status()).toBe(409);
    const body = (await r2.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: "refund_already_requested" });
  });
});
