/**
 * P6-T6: e2e для admin payments — list/filter, refund (COD happy +
 * Uniteller misconfig + amount-exceeds), recheck (COD-блок + auth).
 *
 * Refund тестируем на COD-платеже, потому что у COD нет вызова к
 * Uniteller — full happy-path flow, проверяющий БД-транзакцию (Refund
 * row + Payment.status flip + PaymentLog audit). Uniteller-call'ы
 * требуют живого provider'а — отдельный slot mock-server'ом, P8-T6.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-payments@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Payments",
  role: "admin" as const,
};

const PREFIX = "BGX-T6E2E";

let seedCounter = 0;
function nextOrderNumber(): string {
  seedCounter += 1;
  const seq = String(((Date.now() | 0) + seedCounter) % 999_999).padStart(6, "0");
  return `${PREFIX}-${seq}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

interface SeedSpec {
  provider: "uniteller" | "cod";
  status: "pending" | "captured" | "failed";
  amountCents?: number;
  unitellerOrderIdp?: string | null;
  unitellerBillnumber?: string | null;
}

async function seedPayment(
  input: SeedSpec,
): Promise<{ orderId: string; paymentId: string; orderNumber: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: ADMIN.email },
    select: { id: true },
  });
  const number = nextOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: input.status === "captured" ? "confirmed" : "pending",
      locale: "ru",
      subtotalCents: input.amountCents ?? 100_000_00,
      deliveryCostCents: 0,
      discountCents: 0,
      totalCents: input.amountCents ?? 100_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
    },
    select: { id: true, number: true },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: input.provider,
      status: input.status,
      amountCents: input.amountCents ?? 100_000_00,
      currency: "UZS",
      ...(input.provider === "uniteller"
        ? {
            unitellerOrderIdp: input.unitellerOrderIdp ?? number,
            ...(input.unitellerBillnumber
              ? { unitellerBillnumber: input.unitellerBillnumber }
              : {}),
          }
        : {}),
      ...(input.status === "captured" ? { capturedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return { orderId: order.id, paymentId: payment.id, orderNumber: order.number };
}

async function cleanup(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { number: { startsWith: PREFIX } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return;
  const paymentIds = (
    await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    })
  ).map((p) => p.id);
  if (paymentIds.length > 0) {
    await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.paymentLog.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}

test.describe("P6-T6 · admin payments + refunds", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("anon → POST /api/admin/payments/x/refund → 401", async ({ request }) => {
    const res = await request.post("/api/admin/payments/some_id/refund", {
      data: { amountCents: 1000, reason: "test" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("anon → POST /api/admin/payments/x/recheck → 401", async ({ request }) => {
    const res = await request.post("/api/admin/payments/some_id/recheck");
    expect(res.status()).toBe(401);
  });

  test("customer → POST /api/admin/payments/x/refund → 404 (silent)", async ({ page }) => {
    const customer = {
      email: "e2e-payments-customer@bigmax.uz",
      password: "e2ePass1234",
      name: "Customer",
    };
    await createTestUser(customer);
    try {
      await page.goto("/ru/auth/login");
      await page.locator("input#email").fill(customer.email);
      await page.locator("input#password").fill(customer.password);
      await page.getByRole("button", { name: /^Войти$/ }).click();
      await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
      const res = await page.request.post("/api/admin/payments/some_id/refund", {
        data: { amountCents: 1000, reason: "test" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });

  test("list page → видит seeded платежи", async ({ page }) => {
    const { paymentId, orderNumber } = await seedPayment({
      provider: "uniteller",
      status: "captured",
    });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/payments");
    await expect(page.getByTestId("admin-payments")).toBeVisible();
    const row = page.locator(`tr[data-payment-id="${paymentId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(orderNumber);
  });

  test("filter status=captured скрывает pending-платежи", async ({ page }) => {
    const captured = await seedPayment({ provider: "uniteller", status: "captured" });
    const pending = await seedPayment({ provider: "uniteller", status: "pending" });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/payments?status=captured");
    await expect(page.locator(`tr[data-payment-id="${captured.paymentId}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-payment-id="${pending.paymentId}"]`)).toHaveCount(0);
  });

  test("filter provider=cod скрывает Uniteller", async ({ page }) => {
    const cod = await seedPayment({ provider: "cod", status: "captured" });
    const uniteller = await seedPayment({ provider: "uniteller", status: "captured" });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/payments?provider=cod");
    await expect(page.locator(`tr[data-payment-id="${cod.paymentId}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-payment-id="${uniteller.paymentId}"]`)).toHaveCount(0);
  });

  test("detail page → показывает Refund + Recheck кнопки для captured Uniteller", async ({
    page,
  }) => {
    const { paymentId } = await seedPayment({ provider: "uniteller", status: "captured" });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/payments/${paymentId}`);
    await expect(page.getByTestId("admin-payment-detail")).toBeVisible();
    await expect(page.getByTestId("payment-refund-trigger")).toBeVisible();
    await expect(page.getByTestId("payment-recheck-button")).toBeEnabled();
  });

  test("detail page для COD → Recheck disabled, Refund есть (скип Uniteller)", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/payments/${paymentId}`);
    await expect(page.getByTestId("payment-recheck-button")).toBeDisabled();
    await expect(page.getByTestId("payment-refund-trigger")).toBeVisible();
  });

  test("recheck COD → 400 cod_recheck_unsupported", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/recheck`);
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("cod_recheck_unsupported");
  });

  test("refund COD happy: full → Refund row + Payment.status=refunded + PaymentLog", async ({
    page,
  }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 100_000_00, reason: "Клиент отменил после доставки" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      refundId: string;
      paymentStatus: string;
      refundableRemaining: number;
    };
    expect(body.paymentStatus).toBe("refunded");
    expect(body.refundableRemaining).toBe(0);

    const reloaded = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, refunds: { select: { amountCents: true, status: true } } },
    });
    expect(reloaded.status).toBe("refunded");
    expect(reloaded.refunds).toHaveLength(1);
    expect(reloaded.refunds[0]?.amountCents).toBe(100_000_00);
    expect(reloaded.refunds[0]?.status).toBe("completed");

    const log = await prisma.paymentLog.findFirst({
      where: { paymentId, action: "refund_completed" },
      select: { id: true },
    });
    expect(log).not.toBeNull();
  });

  test("refund COD partial: 30% → Payment.status=partially_refunded + remaining", async ({
    page,
  }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 30_000_00, reason: "Частичный возврат" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { paymentStatus: string; refundableRemaining: number };
    expect(body.paymentStatus).toBe("partially_refunded");
    expect(body.refundableRemaining).toBe(70_000_00);

    const reloaded = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    expect(reloaded.status).toBe("partially_refunded");
  });

  test("refund: amount > remaining → 409 amount_exceeds_remaining", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 999_999_99, reason: "Перебор" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string; remaining: number };
    expect(body.reason).toBe("amount_exceeds_remaining");
    expect(body.remaining).toBe(100_000_00);
  });

  test("refund pending payment → 409 not_refundable", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "uniteller", status: "pending" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 1000, reason: "Преждевременно" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("not_refundable");
  });

  test("refund: invalid_body — отсутствующий reason → 400", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 1000 },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("refund non-existent payment → 404", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/payments/cuid_doesnt_exist/refund", {
      data: { amountCents: 1000, reason: "test reason" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("UI smoke: refund-modal → submit → toast + БД", async ({ page }) => {
    const { paymentId } = await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/payments/${paymentId}`);
    await page.getByTestId("payment-refund-trigger").click();
    await expect(page.getByTestId("payment-refund-form")).toBeVisible();
    // Default amount уже proseed на full remaining → сразу заполняем reason.
    await page.getByTestId("payment-refund-reason").fill("UI smoke test reason");
    await page.getByTestId("payment-refund-submit").click();
    // Ждём router.refresh + toast.
    await expect(page.getByTestId("admin-payment-refunds")).toBeVisible({ timeout: 10_000 });

    const reloaded = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    expect(reloaded.status).toBe("refunded");
  });
});
