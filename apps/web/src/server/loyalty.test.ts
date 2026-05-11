/**
 * P7-T2: тесты pure-helpers + atomic awardLoyaltyPoints / spendLoyaltyPoints.
 *
 * Pure-helpers покрываются обычными vitest'ом без mock'ов. TX-helpers —
 * с fake-tx (`vi.fn()` на user.update + loyaltyTransaction.create), чтобы
 * проверить корректность side-effects и порядок вызовов без БД.
 */

import { describe, expect, it, vi } from "vitest";

import {
  awardLoyaltyPoints,
  clampPointsToSpend,
  computeEarnedPoints,
  computeLoyaltyDiscountCents,
  parseEarnPercent,
  reverseLoyaltyForOrder,
  spendLoyaltyPoints,
  LOYALTY_EARN_PERCENT,
  LOYALTY_EARN_PERCENT_FEATURE_KEY,
  LOYALTY_MIN_ORDER_TO_SPEND_CENTS,
  LOYALTY_POINTS_MAX,
  LOYALTY_POINT_VALUE_CENTS,
  LOYALTY_SPEND_ENABLED_FEATURE_KEY,
} from "./loyalty";

describe("computeEarnedPoints", () => {
  it("0 / negative total → 0", () => {
    expect(computeEarnedPoints(0)).toBe(0);
    expect(computeEarnedPoints(-100)).toBe(0);
  });

  it("< 10_000 тийн (100 сум) → 0 баллов (1% < 1 балла, floor)", () => {
    expect(computeEarnedPoints(9_999)).toBe(0);
    expect(computeEarnedPoints(5_000)).toBe(0);
  });

  it("10_000 тийн → 1 балл", () => {
    // 10_000 * 1% = 100 тийн = 1 балл (100 тийн = 1 сум).
    expect(computeEarnedPoints(10_000)).toBe(1);
  });

  it("1_000_000 тийн (10_000 сум) → 100 баллов", () => {
    expect(computeEarnedPoints(1_000_000)).toBe(100);
  });

  it("округление: 19_999 → 1 балл (не 1.99)", () => {
    // 19_999 * 1% / 100 = 199 / 100 → floor = 1.
    expect(computeEarnedPoints(19_999)).toBe(1);
  });

  it("custom percent работает", () => {
    // 100_000 тийн * 5% = 5_000 тийн / 100 = 50 баллов.
    expect(computeEarnedPoints(100_000, 5)).toBe(50);
  });

  it("0% и негативный percent → 0", () => {
    expect(computeEarnedPoints(100_000, 0)).toBe(0);
    expect(computeEarnedPoints(100_000, -1)).toBe(0);
  });

  it("default percent совпадает с LOYALTY_EARN_PERCENT (1%)", () => {
    expect(LOYALTY_EARN_PERCENT).toBe(1);
    expect(computeEarnedPoints(50_000)).toBe(computeEarnedPoints(50_000, 1));
  });
});

describe("computeLoyaltyDiscountCents", () => {
  it("0 / negative → 0", () => {
    expect(computeLoyaltyDiscountCents(0)).toBe(0);
    expect(computeLoyaltyDiscountCents(-5)).toBe(0);
  });

  it("1 балл = 100 тийн", () => {
    expect(computeLoyaltyDiscountCents(1)).toBe(LOYALTY_POINT_VALUE_CENTS);
    expect(computeLoyaltyDiscountCents(1)).toBe(100);
  });

  it("1_000 баллов = 100_000 тийн (1_000 сум)", () => {
    expect(computeLoyaltyDiscountCents(1_000)).toBe(100_000);
  });
});

describe("clampPointsToSpend", () => {
  it("0 / negative requested → 0", () => {
    expect(clampPointsToSpend(0, 1_000, 1_000_000)).toBe(0);
    expect(clampPointsToSpend(-5, 1_000, 1_000_000)).toBe(0);
  });

  it("0 balance → 0", () => {
    expect(clampPointsToSpend(100, 0, 1_000_000)).toBe(0);
  });

  it("totalCents ≤ POINT_VALUE_CENTS → 0 (нечего тратить)", () => {
    expect(clampPointsToSpend(50, 100, 100)).toBe(0);
    expect(clampPointsToSpend(50, 100, 99)).toBe(0);
  });

  it("P7-T2 sub-task B: totalCents < LOYALTY_MIN_ORDER_TO_SPEND_CENTS → 0", () => {
    // 4_999 сум * 100 = 499_900 тийн — чуть меньше min'а 500_000.
    expect(clampPointsToSpend(50, 1_000, 499_900)).toBe(0);
    // На границе включительно — разрешено.
    expect(clampPointsToSpend(50, 1_000, LOYALTY_MIN_ORDER_TO_SPEND_CENTS)).toBe(50);
  });

  it("clamp по balance", () => {
    // balance < requested → balance.
    expect(clampPointsToSpend(500, 100, 1_000_000)).toBe(100);
  });

  it("clamp по totalCents - 1 (Uniteller rejects 0-amount)", () => {
    // total = 500_000 тийн (минимум, чтобы пройти sub-task B):
    // maxByTotal = floor(499_999/100) = 4_999 баллов.
    expect(clampPointsToSpend(99_999, 1_000_000, 500_000)).toBe(4_999);
  });

  it("clamp по LOYALTY_POINTS_MAX", () => {
    expect(clampPointsToSpend(LOYALTY_POINTS_MAX + 100, 1_000_000_000, 10_000_000_000)).toBe(
      LOYALTY_POINTS_MAX,
    );
  });

  it("non-integer requested → 0 (anti-tamper)", () => {
    expect(clampPointsToSpend(1.5 as unknown as number, 1_000, 1_000_000)).toBe(0);
  });

  it("happy path: requested ≤ balance ≤ maxByTotal → requested", () => {
    expect(clampPointsToSpend(50, 1_000, 1_000_000)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// TX helpers with fake-tx
// ---------------------------------------------------------------------------

function makeFakeTx(): {
  user: { update: ReturnType<typeof vi.fn> };
  loyaltyTransaction: { create: ReturnType<typeof vi.fn> };
} {
  return {
    user: { update: vi.fn().mockResolvedValue({}) },
    loyaltyTransaction: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe("awardLoyaltyPoints", () => {
  it("0 points (total < 10_000 тийн) → no-op", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx
    const awarded = await awardLoyaltyPoints(tx, {
      userId: "u1",
      orderId: "o1",
      totalCents: 9_999,
    });
    expect(awarded).toBe(0);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it("happy path: increment User.loyaltyPoints + LoyaltyTransaction(earn, +N)", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx
    const awarded = await awardLoyaltyPoints(tx, {
      userId: "u1",
      orderId: "o1",
      totalCents: 1_000_000,
    });
    expect(awarded).toBe(100);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { loyaltyPoints: { increment: 100 } },
    });
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", orderId: "o1", points: 100, type: "earn" },
    });
  });
});

describe("spendLoyaltyPoints", () => {
  it("0 points → no-op", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx
    await spendLoyaltyPoints(tx, { userId: "u1", orderId: "o1", points: 0 });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it("negative points → no-op (anti-tamper)", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx
    await spendLoyaltyPoints(tx, { userId: "u1", orderId: "o1", points: -50 });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it("happy path: decrement User.loyaltyPoints + LoyaltyTransaction(spend, -N)", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx
    await spendLoyaltyPoints(tx, { userId: "u1", orderId: "o1", points: 50 });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { loyaltyPoints: { decrement: 50 } },
    });
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", orderId: "o1", points: -50, type: "spend" },
    });
  });
});

// ---------------------------------------------------------------------------
// P7-T2 sub-task A: reverseLoyaltyForOrder
// ---------------------------------------------------------------------------

function makeFakeTxForReversal(
  existing: Array<{
    userId: string;
    points: number;
    type: "earn" | "spend" | "refund" | "clawback";
  }>,
): {
  user: { update: ReturnType<typeof vi.fn> };
  loyaltyTransaction: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
} {
  return {
    user: { update: vi.fn().mockResolvedValue({}) },
    loyaltyTransaction: {
      findMany: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("reverseLoyaltyForOrder", () => {
  it("нет транзакций по заказу → no-op", async () => {
    const tx = makeFakeTxForReversal([]);
    // @ts-expect-error fake-tx
    const r = await reverseLoyaltyForOrder(tx, "o1");
    expect(r).toEqual({ refunded: 0, clawedBack: 0, alreadyReversed: false });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it("net=0 (уже reversed) → idempotent no-op", async () => {
    const tx = makeFakeTxForReversal([
      { userId: "u1", points: -50, type: "spend" },
      { userId: "u1", points: +50, type: "refund" },
    ]);
    // @ts-expect-error fake-tx
    const r = await reverseLoyaltyForOrder(tx, "o1");
    expect(r).toEqual({ refunded: 0, clawedBack: 0, alreadyReversed: true });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("только spend → пишем refund + +N к балансу", async () => {
    const tx = makeFakeTxForReversal([{ userId: "u1", points: -50, type: "spend" }]);
    // @ts-expect-error fake-tx
    const r = await reverseLoyaltyForOrder(tx, "o1");
    expect(r.refunded).toBe(50);
    expect(r.clawedBack).toBe(0);
    expect(r.alreadyReversed).toBe(false);
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", orderId: "o1", points: 50, type: "refund" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { loyaltyPoints: { increment: 50 } },
    });
  });

  it("только earn → пишем clawback + -M к балансу", async () => {
    const tx = makeFakeTxForReversal([{ userId: "u1", points: +30, type: "earn" }]);
    // @ts-expect-error fake-tx
    const r = await reverseLoyaltyForOrder(tx, "o1");
    expect(r.refunded).toBe(0);
    expect(r.clawedBack).toBe(30);
    expect(r.alreadyReversed).toBe(false);
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", orderId: "o1", points: -30, type: "clawback" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { loyaltyPoints: { increment: -30 } },
    });
  });

  it("обе spend + earn → пишем обе reversal-row + net-delta", async () => {
    const tx = makeFakeTxForReversal([
      { userId: "u1", points: -50, type: "spend" },
      { userId: "u1", points: +30, type: "earn" },
    ]);
    // @ts-expect-error fake-tx
    const r = await reverseLoyaltyForOrder(tx, "o1");
    expect(r.refunded).toBe(50);
    expect(r.clawedBack).toBe(30);
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledTimes(2);
    // net = -50 + 30 = -20 → User балланс += -(-20) = +20 (возврат больше изъятия).
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { loyaltyPoints: { increment: 20 } },
    });
  });
});

// ---------------------------------------------------------------------------
// P7-T2 sub-task C: parseEarnPercent (env reader)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// P7-T2 sub-task L: feature-key constants (sanity)
// ---------------------------------------------------------------------------

describe("Loyalty feature keys", () => {
  it("LOYALTY_EARN_PERCENT_FEATURE_KEY совпадает с seed-row из миграции", () => {
    expect(LOYALTY_EARN_PERCENT_FEATURE_KEY).toBe("loyalty.earn_percent");
  });

  it("LOYALTY_SPEND_ENABLED_FEATURE_KEY совпадает с seed-row из миграции", () => {
    expect(LOYALTY_SPEND_ENABLED_FEATURE_KEY).toBe("loyalty.spend_enabled");
  });
});

describe("parseEarnPercent", () => {
  it("undefined → 1", () => {
    expect(parseEarnPercent(undefined)).toBe(1);
  });

  it("пустая строка → 1", () => {
    expect(parseEarnPercent("")).toBe(1);
  });

  it("валидный input → возвращаем", () => {
    expect(parseEarnPercent("0.5")).toBe(0.5);
    expect(parseEarnPercent("5")).toBe(5);
    expect(parseEarnPercent("50")).toBe(50);
  });

  it("вне диапазона [0.01..50] → fallback 1", () => {
    expect(parseEarnPercent("0")).toBe(1);
    expect(parseEarnPercent("0.001")).toBe(1);
    expect(parseEarnPercent("100")).toBe(1);
    expect(parseEarnPercent("-5")).toBe(1);
  });

  it("мусор → 1", () => {
    expect(parseEarnPercent("abc")).toBe(1);
    expect(parseEarnPercent("NaN")).toBe(1);
  });

  it("module-level LOYALTY_EARN_PERCENT consistent", () => {
    // env при тесте либо не задан, либо =1 → fallback.
    expect(LOYALTY_EARN_PERCENT).toBeGreaterThan(0);
    expect(LOYALTY_EARN_PERCENT).toBeLessThanOrEqual(50);
  });
});
