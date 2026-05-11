/**
 * P6-T6 follow-up: e2e для закрытых open question'ов:
 *  (a) Refund Uniteller через mock-server (UNITELLER_BASE_URL override
 *      на mock-server подмешивает все cancelUnitellerPayment'ы туда же).
 *  (b) Refund(status="failed") audit row при provider_error.
 *  (c) Synthetic `unitellerRefundId` = `${billnumber}-r${attemptIndex}`.
 *  (d) Bulk refund (full + fixed mode + skipped[]).
 *
 * Mock-server поднят playwright-config'ом на `http://localhost:8787`,
 * `UNITELLER_BASE_URL` переадресует server-side cancelUnitellerPayment
 * туда же. UNITELLER_SHOP_ID/AUTH_LOGIN/AUTH_PASSWORD должны быть в
 * `.env.local` (любые непустые — mock не валидирует auth для /cancel/).
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-payments-fu@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Payments FU",
  role: "admin" as const,
};

const PREFIX = "BGX-T6FU";
const MOCK_URL = process.env["E2E_MOCK_URL"] ?? "http://localhost:8787";

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
  status: "pending" | "captured";
  amountCents?: number;
  unitellerBillnumber?: string;
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
            unitellerOrderIdp: number,
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

async function clearMockState(): Promise<void> {
  await fetch(`${MOCK_URL}/admin/state`, { method: "DELETE" }).catch(() => {});
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

test.describe("P6-T6 follow-up · Uniteller refund + audit + bulk", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
    await clearMockState();
  });

  test.afterEach(async () => {
    await cleanup();
    await clearMockState();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("(a)+(c) Uniteller refund happy → mock /cancel/ → Refund(completed) + synthetic id", async ({
    page,
  }) => {
    const billnumber = "RRN-T6FU-001";
    const { paymentId, orderNumber } = await seedPayment({
      provider: "uniteller",
      status: "captured",
      unitellerBillnumber: billnumber,
    });
    await loginAsAdmin(page);

    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 100_000_00, reason: "Брак товара (e2e)" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      paymentStatus: string;
      unitellerRefundId: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.paymentStatus).toBe("refunded");
    // (c) synthetic id = `${billnumber}-r${attemptIndex}` — первый attempt → r1.
    expect(body.unitellerRefundId).toBe(`${billnumber}-r1`);

    // Refund row в БД с заполненным unitellerRefundId.
    const refunds = await prisma.refund.findMany({
      where: { paymentId },
      select: { status: true, unitellerRefundId: true, amountCents: true },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.status).toBe("completed");
    expect(refunds[0]?.unitellerRefundId).toBe(`${billnumber}-r1`);

    // Mock-server увидел /cancel/ → state на Canceled.
    const mockState = (await (await fetch(`${MOCK_URL}/admin/state/${orderNumber}`)).json()) as {
      ok: boolean;
      order?: { status: string };
    };
    expect(mockState.ok).toBe(true);
    expect(mockState.order?.status).toBe("Canceled");
  });

  test("(c) Synthetic id увеличивается с каждой попыткой (включая failed-row'ы)", async ({
    page,
  }) => {
    const { paymentId } = await seedPayment({
      provider: "uniteller",
      status: "captured",
      unitellerBillnumber: "RRN-T6FU-002",
    });

    // Сначала вручную создаём failed-refund (имитируем предыдущую неудачную
    // попытку), чтобы attemptIndex = 2 на следующем call'е.
    await prisma.refund.create({
      data: {
        paymentId,
        amountCents: 50_000_00,
        reason: "Старая failed-попытка",
        status: "failed",
      },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 100_000_00, reason: "Повторная попытка" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { unitellerRefundId: string };
    expect(body.unitellerRefundId).toBe("RRN-T6FU-002-r2");
  });

  test("(b) Refund(failed) audit row НЕ резервирует remaining — admin может ретраить full", async ({
    page,
  }) => {
    // Seed: captured COD-платёж + предыдущая failed-попытка на 50%. Если бы
    // failed зачёл — admin не смог бы вернуть полную сумму. Тест подтверждает
    // что failed НЕ резервирует (computeRefundableRemaining исключает их).
    // Provider_error sad-path для Uniteller не воспроизводится — наш mock не
    // имеет режима «отдай Error» — coverage ложится на `client.test.ts` в
    // `@bigmax/payments` (cancelUnitellerPayment с fetchImpl returning
    // <Status>Error</Status>) + unit-тестам refund-execute.ts.
    const { paymentId } = await seedPayment({
      provider: "cod",
      status: "captured",
      amountCents: 100_000_00,
    });
    await prisma.refund.create({
      data: {
        paymentId,
        amountCents: 50_000_00,
        reason: "Старая failed-попытка",
        status: "failed",
      },
    });

    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
      data: { amountCents: 100_000_00, reason: "Финальный возврат после ретрая" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { paymentStatus: string; refundableRemaining: number };
    expect(body.paymentStatus).toBe("refunded");
    expect(body.refundableRemaining).toBe(0);

    // В БД: 1 failed (старый) + 1 completed (только что).
    const refunds = await prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: "asc" },
      select: { status: true, amountCents: true },
    });
    expect(refunds).toHaveLength(2);
    expect(refunds[0]?.status).toBe("failed");
    expect(refunds[1]?.status).toBe("completed");
    expect(refunds[1]?.amountCents).toBe(100_000_00);
  });

  test("(d) Bulk refund full mode → 2 платежа → processed=2 + skipped=[]", async ({ page }) => {
    const p1 = await seedPayment({
      provider: "uniteller",
      status: "captured",
      unitellerBillnumber: "RRN-BULK-1",
    });
    const p2 = await seedPayment({
      provider: "cod",
      status: "captured",
    });
    await preSeedMockOrder(p1.orderNumber, "RRN-BULK-1");

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/payments/bulk-refund", {
      data: {
        paymentIds: [p1.paymentId, p2.paymentId],
        reason: "Партия с браком (bulk e2e)",
        mode: "full",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      processed: Array<{ paymentId: string; amountCents: number }>;
      skipped: unknown[];
    };
    expect(body.processed).toHaveLength(2);
    expect(body.skipped).toHaveLength(0);

    const reloaded = await prisma.payment.findMany({
      where: { id: { in: [p1.paymentId, p2.paymentId] } },
      select: { id: true, status: true },
    });
    expect(reloaded.every((p) => p.status === "refunded")).toBe(true);
  });

  test("(d) Bulk refund mode=fixed amountCents → partial flip", async ({ page }) => {
    const p1 = await seedPayment({ provider: "cod", status: "captured" });
    const p2 = await seedPayment({ provider: "cod", status: "captured" });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/payments/bulk-refund", {
      data: {
        paymentIds: [p1.paymentId, p2.paymentId],
        reason: "Частичный возврат партии",
        mode: "fixed",
        amountCents: 30_000_00,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { processed: unknown[] };
    expect(body.processed).toHaveLength(2);

    const reloaded = await prisma.payment.findMany({
      where: { id: { in: [p1.paymentId, p2.paymentId] } },
      select: { status: true },
    });
    expect(reloaded.every((p) => p.status === "partially_refunded")).toBe(true);
  });

  test("(d) Bulk: not_refundable + payment_not_found → в skipped[]", async ({ page }) => {
    const captured = await seedPayment({ provider: "cod", status: "captured" });
    const pending = await seedPayment({ provider: "cod", status: "pending" });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/payments/bulk-refund", {
      data: {
        paymentIds: [captured.paymentId, pending.paymentId, "cuid_doesnt_exist"],
        reason: "Микс happy и провалов",
        mode: "full",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      processed: Array<{ paymentId: string }>;
      skipped: Array<{ paymentId: string; reason: string }>;
    };
    expect(body.processed).toHaveLength(1);
    expect(body.processed[0]?.paymentId).toBe(captured.paymentId);
    expect(body.skipped).toHaveLength(2);
    const reasons = body.skipped.map((s) => s.reason).sort();
    expect(reasons).toEqual(["not_refundable", "payment_not_found"]);
  });

  test("(d) Bulk: paymentIds > 50 → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const res = await page.request.post("/api/admin/payments/bulk-refund", {
      data: { paymentIds: ids, reason: "Слишком много", mode: "full" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("(d) Bulk: anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/payments/bulk-refund", {
      data: { paymentIds: ["x"], reason: "ok ok ok", mode: "full" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("(d) Bulk UI: bulk-bar появляется при checkbox-click", async ({ page }) => {
    await seedPayment({ provider: "cod", status: "captured" });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/payments");
    await expect(page.getByTestId("admin-payments-bulk-bar")).toHaveCount(0);
    const firstCheckbox = page.getByTestId("admin-payments-row-checkbox").first();
    await firstCheckbox.check();
    await expect(page.getByTestId("admin-payments-bulk-bar")).toBeVisible();
    // Mode-radio видны.
    await expect(page.getByTestId("admin-payments-bulk-mode-full")).toBeVisible();
    await expect(page.getByTestId("admin-payments-bulk-mode-fixed")).toBeVisible();
  });
});
