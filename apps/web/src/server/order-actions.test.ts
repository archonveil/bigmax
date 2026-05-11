/**
 * P5-T2: pure-helpers для refund-eligibility + Zod-схема reason.
 */

import { describe, expect, it } from "vitest";

import {
  RefundRequestSchema,
  validateRefundEligibility,
  type RefundEligibilityInput,
} from "./order-actions";

const PAYMENT = { id: "p_1", status: "captured", amountCents: 100_000_00 } as const;

function input(overrides: Partial<RefundEligibilityInput> = {}): RefundEligibilityInput {
  return {
    order: { status: "delivered" },
    payments: [PAYMENT],
    refunds: [],
    ...overrides,
  };
}

describe("validateRefundEligibility · happy", () => {
  it("captured payment + delivered + no refunds → eligible", () => {
    expect(validateRefundEligibility(input())).toEqual({
      eligible: true,
      paymentId: "p_1",
      amountCents: 100_000_00,
    });
  });

  it("captured payment + confirmed/shipped → также eligible (можно вернуть до доставки)", () => {
    expect(validateRefundEligibility(input({ order: { status: "confirmed" } })).eligible).toBe(
      true,
    );
    expect(validateRefundEligibility(input({ order: { status: "shipped" } })).eligible).toBe(true);
  });

  it("прошлый failed-refund НЕ блокирует — можно перезапросить", () => {
    const result = validateRefundEligibility(
      input({ refunds: [{ paymentId: "p_1", status: "failed" }] }),
    );
    expect(result.eligible).toBe(true);
  });
});

describe("validateRefundEligibility · отказы", () => {
  it("Order.status === cancelled → order_cancelled", () => {
    expect(validateRefundEligibility(input({ order: { status: "cancelled" } }))).toEqual({
      eligible: false,
      reason: "order_cancelled",
    });
  });

  it("нет captured payments → no_captured_payment", () => {
    expect(
      validateRefundEligibility(
        input({ payments: [{ id: "p_x", status: "pending", amountCents: 1 }] }),
      ),
    ).toEqual({ eligible: false, reason: "no_captured_payment" });
  });

  it("payments=[] → no_captured_payment", () => {
    expect(validateRefundEligibility(input({ payments: [] }))).toEqual({
      eligible: false,
      reason: "no_captured_payment",
    });
  });

  it("failed payment без captured → no_captured_payment", () => {
    expect(
      validateRefundEligibility(
        input({ payments: [{ id: "p_x", status: "failed", amountCents: 1 }] }),
      ),
    ).toEqual({ eligible: false, reason: "no_captured_payment" });
  });

  it("уже есть pending Refund → refund_already_requested", () => {
    expect(
      validateRefundEligibility(input({ refunds: [{ paymentId: "p_1", status: "pending" }] })),
    ).toEqual({ eligible: false, reason: "refund_already_requested" });
  });

  it("уже есть completed Refund → refund_already_completed", () => {
    expect(
      validateRefundEligibility(input({ refunds: [{ paymentId: "p_1", status: "completed" }] })),
    ).toEqual({ eligible: false, reason: "refund_already_completed" });
  });

  it("completed > pending: completed первым возвращается, даже если pending тоже есть", () => {
    expect(
      validateRefundEligibility(
        input({
          refunds: [
            { paymentId: "p_1", status: "pending" },
            { paymentId: "p_1", status: "completed" },
          ],
        }),
      ),
    ).toEqual({ eligible: false, reason: "refund_already_completed" });
  });

  it("Refund для другого Payment не блокирует наш captured", () => {
    expect(
      validateRefundEligibility(
        input({
          payments: [PAYMENT, { id: "p_2", status: "captured", amountCents: 5 }],
          refunds: [{ paymentId: "p_2", status: "pending" }],
        }),
      ).eligible,
    ).toBe(true);
  });
});

describe("RefundRequestSchema", () => {
  it("валидный reason — 10..1000 символов", () => {
    const r = RefundRequestSchema.safeParse({ reason: "Товар пришёл повреждённым." });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("Товар пришёл повреждённым.");
  });

  it("trim применяется ДО length-проверки — пустые пробелы не проходят", () => {
    const r = RefundRequestSchema.safeParse({ reason: "          " });
    expect(r.success).toBe(false);
  });

  it("слишком короткий reason (<10) → fail с reason_too_short", () => {
    const r = RefundRequestSchema.safeParse({ reason: "коротко" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("reason_too_short");
    }
  });

  it("слишком длинный reason (>1000) → fail с reason_too_long", () => {
    const r = RefundRequestSchema.safeParse({ reason: "x".repeat(1001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("reason_too_long");
    }
  });

  it("отсутствует reason → fail (zod.required)", () => {
    expect(RefundRequestSchema.safeParse({}).success).toBe(false);
  });

  it("reason: 12345 (number) → fail", () => {
    expect(RefundRequestSchema.safeParse({ reason: 12345 }).success).toBe(false);
  });
});
