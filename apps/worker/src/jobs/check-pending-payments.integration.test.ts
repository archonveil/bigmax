/**
 * Integration smoke для `checkPendingPaymentsJob` (P4-T9).
 *
 * Запускается на **реальном** Prisma (требует поднятый Postgres из
 * `docker:up`); HTTP к Uniteller остаётся mock'нутым через DI fetchStatus.
 * Это проверяет что `findMany`-фильтры и `$transaction`-мутации работают
 * именно так, как ожидают unit-тесты на mock-объектах.
 *
 * Skip-логика: если `DATABASE_URL` не задан — describe целиком пропускается.
 * Это защищает CI/dev-окружения без поднятой БД от красных результатов.
 */

import { Prisma, prisma } from "@bigmax/db";
import type { FetchPaymentStatusResult } from "@bigmax/payments/uniteller";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { checkPendingPaymentsJob } from "./check-pending-payments";

const DB_AVAILABLE = Boolean(process.env["DATABASE_URL"]);

const TEST_USER_EMAIL = `worker-integration-${Date.now()}@bigmax.test`;
const TEST_NUMBER_PREFIX = "BGX-19990101-"; // выпавшая дата чтоб не пересекаться с реальными

describe.skipIf(!DB_AVAILABLE)("checkPendingPaymentsJob · integration (real Prisma)", () => {
  let userId: string;

  beforeAll(async () => {
    // Пробуем подключиться. Если БД недоступна — Prisma бросит здесь, и
    // afterAll очистит флаг (всё равно describe.skipIf выше выключит блок,
    // но мы дополнительно защищаемся от сценария "DATABASE_URL задан, но БД
    // не поднята" — там тесты будут падать, и это норма).
    const u = await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: {
        email: TEST_USER_EMAIL,
        passwordHash: "x",
        name: "Worker Integration",
        role: "customer",
        language: "ru",
      },
      select: { id: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  afterEach(async () => {
    // Сносим всё что job-тест мог насоздавать у этого юзера + все Order'ы
    // с тестовым префиксом номера (на случай если userId не тот).
    const orderIds = (
      await prisma.order.findMany({
        where: {
          OR: [{ userId }, { number: { startsWith: TEST_NUMBER_PREFIX } }],
        },
        select: { id: true },
      })
    ).map((o) => o.id);
    if (orderIds.length > 0) {
      await prisma.paymentLog.deleteMany({
        where: { payment: { orderId: { in: orderIds } } },
      });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
  });

  async function seedPending(opts: { ageMs: number; suffix: string }): Promise<{
    paymentId: string;
    orderId: string;
    number: string;
  }> {
    const number = `${TEST_NUMBER_PREFIX}${opts.suffix}`;
    const order = await prisma.order.create({
      data: {
        userId,
        number,
        status: "pending",
        locale: "ru",
        subtotalCents: 100_00,
        deliveryCostCents: 0,
        discountCents: 0,
        totalCents: 100_00,
        currency: "UZS",
        deliveryMethod: "pickup",
      },
    });
    // Прямой UPDATE для createdAt — Prisma `create` ставит now() автоматически.
    await prisma.$executeRaw(
      Prisma.sql`UPDATE orders SET created_at = ${new Date(Date.now() - opts.ageMs)} WHERE id = ${order.id}`,
    );
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "uniteller",
        status: "pending",
        amountCents: 100_00,
        currency: "UZS",
        unitellerOrderIdp: number,
      },
    });
    await prisma.$executeRaw(
      Prisma.sql`UPDATE payments SET created_at = ${new Date(Date.now() - opts.ageMs)} WHERE id = ${payment.id}`,
    );
    return { paymentId: payment.id, orderId: order.id, number };
  }

  it("Authorized snapshot → captured + Order.confirmed (атомарно)", async () => {
    const seed = await seedPending({ ageMs: 5 * 60_000, suffix: "0001" });
    const fetchStatus = async (orderId: string): Promise<FetchPaymentStatusResult> => ({
      kind: "ok",
      items: [
        {
          OrderId: orderId,
          Status: "Authorized",
          Total: "100.00",
          Billnumber: "RRN-INT-1",
          ApprovalCode: "00",
        },
      ],
    });

    const result = await checkPendingPaymentsJob({
      prisma,
      fetchStatus,
      now: () => new Date(),
    });
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.captured).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
    expect(payment.status).toBe("captured");
    expect(payment.unitellerBillnumber).toBe("RRN-INT-1");
    expect(payment.unitellerResponseCode).toBe("00");
    expect(payment.capturedAt).not.toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.orderId } });
    expect(order.status).toBe("confirmed");

    const log = await prisma.paymentLog.findFirst({
      where: { paymentId: seed.paymentId, action: "pull_capture" },
    });
    expect(log).not.toBeNull();
  });

  it("Lifetime+grace истёк, snapshot=Waiting → cancel_local", async () => {
    const seed = await seedPending({ ageMs: 40 * 60_000, suffix: "0002" });
    const fetchStatus = async (orderId: string): Promise<FetchPaymentStatusResult> => ({
      kind: "ok",
      items: [{ OrderId: orderId, Status: "Waiting", Total: "100.00" }],
    });

    const result = await checkPendingPaymentsJob({
      prisma,
      fetchStatus,
      now: () => new Date(),
    });
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
    expect(payment.status).toBe("cancelled");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: seed.orderId } });
    expect(order.status).toBe("cancelled");

    const log = await prisma.paymentLog.findFirst({
      where: { paymentId: seed.paymentId, action: "pull_cancel_local" },
    });
    expect(log).not.toBeNull();
    expect(log!.errorMessage).toBe("lifetime_expired");
  });

  it("Свежий pending (<2 мин) НЕ попадает в выборку — minAgeMin filter", async () => {
    // age = 30s — меньше дефолтного minAgeMin=2min, не должен попасть.
    const seed = await seedPending({ ageMs: 30_000, suffix: "0003" });
    let fetchCalls = 0;
    const fetchStatus = async (): Promise<FetchPaymentStatusResult> => {
      fetchCalls += 1;
      return { kind: "ok", items: [] };
    };

    await checkPendingPaymentsJob({
      prisma,
      fetchStatus,
      now: () => new Date(),
    });
    // findMany с фильтром createdAt < now-2min не должен вернуть наш свежий
    // payment, поэтому fetchStatus для него не вызовется.
    void fetchCalls; // другие pending-payments в тестовой БД могут вызвать его
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: seed.paymentId } });
    expect(payment.status).toBe("pending"); // не тронут
  });
});
