/**
 * P6-T6: Pure-helpers для admin-payments — querystring sanitize, refund
 * Zod, refundable_remaining арифметика, canRefundPayment.
 */

import { describe, expect, it } from "vitest";

import {
  RefundBulkSchema,
  RefundCreateSchema,
  canRefundPayment,
  computeRefundableRemaining,
  parseAdminPaymentListQuery,
} from "./admin-payments";

describe("parseAdminPaymentListQuery", () => {
  it("пустые → defaults", () => {
    expect(parseAdminPaymentListQuery({})).toEqual({
      q: null,
      status: null,
      provider: null,
      page: 1,
    });
  });

  it("undefined → defaults", () => {
    expect(parseAdminPaymentListQuery(undefined)).toEqual({
      q: null,
      status: null,
      provider: null,
      page: 1,
    });
  });

  it("happy: status + provider + q + page", () => {
    const r = parseAdminPaymentListQuery({
      status: "captured",
      provider: "uniteller",
      q: "BGX-2026",
      page: "3",
    });
    expect(r).toEqual({ q: "BGX-2026", status: "captured", provider: "uniteller", page: 3 });
  });

  it("неизвестный status → null", () => {
    expect(parseAdminPaymentListQuery({ status: "bogus" }).status).toBeNull();
  });

  it("неизвестный provider → null", () => {
    expect(parseAdminPaymentListQuery({ provider: "stripe" }).provider).toBeNull();
  });

  it("page нечисло → 1", () => {
    expect(parseAdminPaymentListQuery({ page: "abc" }).page).toBe(1);
  });

  it("q триммится и обрезается до 100", () => {
    const long = "x".repeat(200);
    expect(parseAdminPaymentListQuery({ q: long }).q?.length).toBe(100);
  });

  it("array values → берём первый", () => {
    expect(parseAdminPaymentListQuery({ status: ["captured", "failed"] }).status).toBe("captured");
  });
});

describe("RefundCreateSchema", () => {
  it("happy: amountCents + reason ≥ 3 chars → ok", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: 100, reason: "Брак товара" }).success).toBe(
      true,
    );
  });

  it("amountCents = 0 → fail", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: 0, reason: "ok" }).success).toBe(false);
  });

  it("amountCents = -100 → fail", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: -100, reason: "ok" }).success).toBe(false);
  });

  it("amountCents float → fail (integer required)", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: 99.99, reason: "ok" }).success).toBe(false);
  });

  it("amountCents > 1B → fail", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: 1_000_000_001, reason: "ok" }).success).toBe(
      false,
    );
  });

  it("reason < 3 chars → reason_too_short", () => {
    const r = RefundCreateSchema.safeParse({ amountCents: 100, reason: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_short");
  });

  it("reason > 500 chars → reason_too_long", () => {
    const reason = "x".repeat(501);
    const r = RefundCreateSchema.safeParse({ amountCents: 100, reason });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_long");
  });

  it("strict: лишние поля → fail", () => {
    expect(RefundCreateSchema.safeParse({ amountCents: 100, reason: "ok", extra: 1 }).success).toBe(
      false,
    );
  });

  it("reason пробелы триммятся", () => {
    const r = RefundCreateSchema.safeParse({ amountCents: 100, reason: "   ok and more   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("ok and more");
  });
});

describe("computeRefundableRemaining", () => {
  it("без рефандов → full amount", () => {
    expect(computeRefundableRemaining(100_000, [])).toBe(100_000);
  });

  it("один completed refund → minus", () => {
    expect(
      computeRefundableRemaining(100_000, [{ amountCents: 30_000, status: "completed" }]),
    ).toBe(70_000);
  });

  it("pending refund тоже резервирует (защита от race)", () => {
    expect(computeRefundableRemaining(100_000, [{ amountCents: 30_000, status: "pending" }])).toBe(
      70_000,
    );
  });

  it("failed refund НЕ резервирует", () => {
    expect(computeRefundableRemaining(100_000, [{ amountCents: 30_000, status: "failed" }])).toBe(
      100_000,
    );
  });

  it("несколько completed → суммируются", () => {
    expect(
      computeRefundableRemaining(100_000, [
        { amountCents: 30_000, status: "completed" },
        { amountCents: 20_000, status: "completed" },
      ]),
    ).toBe(50_000);
  });

  it("остаток никогда не отрицательный (clamp на 0)", () => {
    expect(
      computeRefundableRemaining(100_000, [
        { amountCents: 80_000, status: "completed" },
        { amountCents: 50_000, status: "completed" },
      ]),
    ).toBe(0);
  });
});

describe("RefundBulkSchema", () => {
  it("happy: full mode + ids + reason → ok", () => {
    expect(
      RefundBulkSchema.safeParse({
        paymentIds: ["a"],
        reason: "Bulk reason",
        mode: "full",
      }).success,
    ).toBe(true);
  });

  it("happy: fixed mode + amountCents → ok", () => {
    expect(
      RefundBulkSchema.safeParse({
        paymentIds: ["a", "b"],
        reason: "Партия с браком",
        mode: "fixed",
        amountCents: 50_000,
      }).success,
    ).toBe(true);
  });

  it("fixed без amountCents → fail", () => {
    expect(
      RefundBulkSchema.safeParse({
        paymentIds: ["a"],
        reason: "ok",
        mode: "fixed",
      }).success,
    ).toBe(false);
  });

  it("неизвестный mode → fail", () => {
    expect(
      RefundBulkSchema.safeParse({
        paymentIds: ["a"],
        reason: "ok",
        mode: "bogus",
      }).success,
    ).toBe(false);
  });

  it("paymentIds > 50 → fail", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect(
      RefundBulkSchema.safeParse({ paymentIds: ids, reason: "ok", mode: "full" }).success,
    ).toBe(false);
  });

  it("paymentIds = [] → fail", () => {
    expect(RefundBulkSchema.safeParse({ paymentIds: [], reason: "ok", mode: "full" }).success).toBe(
      false,
    );
  });

  it("reason < 3 → fail", () => {
    expect(
      RefundBulkSchema.safeParse({ paymentIds: ["a"], reason: "ab", mode: "full" }).success,
    ).toBe(false);
  });
});

describe("canRefundPayment", () => {
  it.each([
    ["captured", true],
    ["partially_refunded", true],
  ])("%s → %s", (status, expected) => {
    expect(canRefundPayment(status)).toBe(expected);
  });

  it.each([
    ["pending", false],
    ["failed", false],
    ["cancelled", false],
    ["refunded", false],
  ])("%s → %s", (status, expected) => {
    expect(canRefundPayment(status)).toBe(expected);
  });
});
