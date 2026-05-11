/**
 * P4-T6: webhook `POST /api/webhooks/uniteller`. Покрываем все ветки §5.7:
 *   1. Authorized → 200, Payment.captured + Order.confirmed.
 *   2. Waiting → 200, Payment остаётся pending.
 *   3. Невалидная подпись → 401, Payment не тронут.
 *   4. Дубль callback'а с тем же Signature → второй ответ 200 (идемпотентно).
 *   5. Чужой Order_ID (нет Payment) → 200 + log foreign tx.
 *   6. Невалидный payload (без Order_ID) → 400.
 *
 * Используем `prisma` напрямую для seeding/asserts — webhook public, auth
 * не нужен; HTTP-route проверяем через page.request.post.
 */

import { prisma } from "@bigmax/db";
import { uniteller } from "@bigmax/payments";
import { expect, test } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-webhook@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Webhook",
};

const PASSWORD = process.env["UNITELLER_PASSWORD"] ?? "bigmax-dev-placeholder-change-in-prod";

interface SeededOrder {
  orderId: string;
  paymentId: string;
  orderNumber: string;
}

async function seedOrderWithPayment(): Promise<SeededOrder> {
  await createTestUser(USER);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USER.email },
    select: { id: true },
  });

  // Уникальный Order.number в пределах теста: используем timestamp как seq.
  const seq = String(((Date.now() / 1000) | 0) % 9999).padStart(4, "0");
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const number = `BGX-${yyyy}${mm}${dd}-${seq}`;

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      number,
      status: "pending",
      locale: "ru",
      subtotalCents: 25_000_00,
      deliveryCostCents: 50_000_00,
      discountCents: 0,
      totalCents: 75_000_00,
      currency: "UZS",
      deliveryMethod: "courier",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "uniteller",
      status: "pending",
      amountCents: 75_000_00,
      currency: "UZS",
      unitellerOrderIdp: number,
    },
  });
  return { orderId: order.id, paymentId: payment.id, orderNumber: number };
}

async function cleanupWebhookEvents(externalId: string): Promise<void> {
  await prisma.webhookEvent.deleteMany({ where: { externalId } });
}

test.afterEach(async () => {
  await deleteTestUser(USER.email);
});

test("Authorized callback → Payment.captured + Order.confirmed", async ({ request }) => {
  const seed = await seedOrderWithPayment();
  const sig = uniteller.computeCallbackSignature(seed.orderNumber, "Authorized", PASSWORD);

  const body = new URLSearchParams({
    Order_ID: seed.orderNumber,
    Status: "Authorized",
    Signature: sig,
    Billnumber: "RRN-00001",
    Response_Code: "00",
    CardNumber: "4000 **** **** 2487",
  });

  const res = await request.post("/api/webhooks/uniteller", {
    data: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(res.status()).toBe(200);

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
  expect(payment.status).toBe("captured");
  expect(payment.unitellerBillnumber).toBe("RRN-00001");
  expect(payment.unitellerResponseCode).toBe("00");
  expect(payment.unitellerCardMask).toBe("4000 **** **** 2487");
  expect(payment.capturedAt).not.toBeNull();

  const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.orderId } });
  expect(order.status).toBe("confirmed");

  const events = await prisma.webhookEvent.findMany({ where: { externalId: seed.orderNumber } });
  expect(events).toHaveLength(1);
  expect(events[0]!.processed).toBe(true);

  await cleanupWebhookEvents(seed.orderNumber);
});

test("Waiting callback → Payment остаётся pending", async ({ request }) => {
  const seed = await seedOrderWithPayment();
  const sig = uniteller.computeCallbackSignature(seed.orderNumber, "Waiting", PASSWORD);

  const res = await request.post("/api/webhooks/uniteller", {
    data: new URLSearchParams({
      Order_ID: seed.orderNumber,
      Status: "Waiting",
      Signature: sig,
    }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(res.status()).toBe(200);

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
  expect(payment.status).toBe("pending");
  expect(payment.capturedAt).toBeNull();

  const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.orderId } });
  expect(order.status).toBe("pending");

  await cleanupWebhookEvents(seed.orderNumber);
});

test("Невалидная подпись → 401, Payment не тронут", async ({ request }) => {
  const seed = await seedOrderWithPayment();

  const res = await request.post("/api/webhooks/uniteller", {
    data: new URLSearchParams({
      Order_ID: seed.orderNumber,
      Status: "Authorized",
      Signature: "X".repeat(32),
    }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(res.status()).toBe(401);

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
  expect(payment.status).toBe("pending");

  // WebhookEvent не должен быть создан при невалидной подписи.
  const events = await prisma.webhookEvent.findMany({ where: { externalId: seed.orderNumber } });
  expect(events).toHaveLength(0);
});

test("Дубль callback'а с тем же Signature → 200, обновление один раз", async ({ request }) => {
  const seed = await seedOrderWithPayment();
  const sig = uniteller.computeCallbackSignature(seed.orderNumber, "Authorized", PASSWORD);

  const send = (): Promise<unknown> =>
    request.post("/api/webhooks/uniteller", {
      data: new URLSearchParams({
        Order_ID: seed.orderNumber,
        Status: "Authorized",
        Signature: sig,
        Billnumber: "RRN-00042",
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

  const first = (await send()) as { status: () => number };
  expect(first.status()).toBe(200);
  const second = (await send()) as { status: () => number };
  expect(second.status()).toBe(200);

  const events = await prisma.webhookEvent.findMany({ where: { externalId: seed.orderNumber } });
  expect(events).toHaveLength(1); // unique constraint не позволил создать дубль
  expect(events[0]!.processed).toBe(true);

  // PaymentLog: только 1 запись webhook (на первом проходе) — duplicate
  // ветка возвращает 200 без логирования.
  const logs = await prisma.paymentLog.findMany({
    where: { paymentId: seed.paymentId, action: "webhook" },
  });
  expect(logs).toHaveLength(1);

  await cleanupWebhookEvents(seed.orderNumber);
});

test("Чужой Order_ID (нет Payment) → 200 + foreign log", async ({ request }) => {
  const foreignOrderId = "BGX-19990101-0001"; // никогда не существовал
  const sig = uniteller.computeCallbackSignature(foreignOrderId, "Authorized", PASSWORD);

  const res = await request.post("/api/webhooks/uniteller", {
    data: new URLSearchParams({
      Order_ID: foreignOrderId,
      Status: "Authorized",
      Signature: sig,
    }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(res.status()).toBe(200);

  // Event создан и помечен processed (чтобы Uniteller не ретраил).
  const events = await prisma.webhookEvent.findMany({ where: { externalId: foreignOrderId } });
  expect(events).toHaveLength(1);
  expect(events[0]!.processed).toBe(true);

  await cleanupWebhookEvents(foreignOrderId);
});

test("Невалидный payload (без Order_ID) → 400", async ({ request }) => {
  const res = await request.post("/api/webhooks/uniteller", {
    data: new URLSearchParams({
      Status: "Authorized",
      Signature: "X".repeat(32),
    }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(res.status()).toBe(400);
});
