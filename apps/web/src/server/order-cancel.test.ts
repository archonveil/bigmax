/**
 * P5-T4: pure-eligibility для cancel-flow клиента.
 */

import { describe, expect, it } from "vitest";

import {
  CancelRequestSchema,
  validateCancelEligibility,
  type CancelEligibilityInput,
} from "./order-cancel";

const COD_PENDING = {
  id: "p_cod",
  provider: "cod",
  status: "pending",
  unitellerBillnumber: null,
  unitellerOrderIdp: null,
} as const;

const UNITELLER_CAPTURED = {
  id: "p_unt",
  provider: "uniteller",
  status: "captured",
  unitellerBillnumber: "RRN-12345",
  unitellerOrderIdp: "BGX-20260427-0001",
} as const;

const UNITELLER_PENDING = {
  id: "p_unt2",
  provider: "uniteller",
  status: "pending",
  unitellerBillnumber: null,
  unitellerOrderIdp: "BGX-20260427-0002",
} as const;

function input(overrides: Partial<CancelEligibilityInput> = {}): CancelEligibilityInput {
  return {
    order: { status: "pending" },
    payments: [COD_PENDING],
    refunds: [],
    ...overrides,
  };
}

describe("validateCancelEligibility · happy", () => {
  it("pending COD → eligible с capturedPayment=null", () => {
    expect(validateCancelEligibility(input())).toEqual({
      eligible: true,
      capturedPayment: null,
    });
  });

  it("confirmed COD → eligible (захвата у COD нет, capturedPayment=null)", () => {
    expect(validateCancelEligibility(input({ order: { status: "confirmed" } }))).toEqual({
      eligible: true,
      capturedPayment: null,
    });
  });

  it("confirmed Uniteller captured → eligible с заполненным capturedPayment", () => {
    expect(
      validateCancelEligibility({
        order: { status: "confirmed" },
        payments: [UNITELLER_CAPTURED],
        refunds: [],
      }),
    ).toEqual({
      eligible: true,
      capturedPayment: {
        id: "p_unt",
        billnumber: "RRN-12345",
        orderIdp: "BGX-20260427-0001",
      },
    });
  });

  it("pending Uniteller (не captured) → eligible с capturedPayment=null", () => {
    expect(
      validateCancelEligibility({
        order: { status: "pending" },
        payments: [UNITELLER_PENDING],
        refunds: [],
      }),
    ).toEqual({ eligible: true, capturedPayment: null });
  });

  it("failed Refund на captured платёж — НЕ блок (admin отклонил, юзер отменяет)", () => {
    const result = validateCancelEligibility({
      order: { status: "confirmed" },
      payments: [UNITELLER_CAPTURED],
      refunds: [{ paymentId: "p_unt", status: "failed" }],
    });
    expect(result.eligible).toBe(true);
  });
});

describe("validateCancelEligibility · отказы", () => {
  it.each(["packing", "shipped", "delivered"])("%s → order_too_late", (status) => {
    expect(validateCancelEligibility(input({ order: { status } }))).toEqual({
      eligible: false,
      reason: "order_too_late",
    });
  });

  it.each(["cancelled", "refunded"])("%s → order_already_cancelled", (status) => {
    expect(validateCancelEligibility(input({ order: { status } }))).toEqual({
      eligible: false,
      reason: "order_already_cancelled",
    });
  });

  it("неизвестный Order.status → order_too_late (paranoia)", () => {
    expect(validateCancelEligibility(input({ order: { status: "frozen_in_carbonite" } }))).toEqual({
      eligible: false,
      reason: "order_too_late",
    });
  });

  it("pending Refund на captured payment → refund_in_progress", () => {
    expect(
      validateCancelEligibility({
        order: { status: "confirmed" },
        payments: [UNITELLER_CAPTURED],
        refunds: [{ paymentId: "p_unt", status: "pending" }],
      }),
    ).toEqual({ eligible: false, reason: "refund_in_progress" });
  });

  it("Refund на ДРУГОЙ payment не блокирует cancel", () => {
    const result = validateCancelEligibility({
      order: { status: "confirmed" },
      payments: [UNITELLER_CAPTURED],
      refunds: [{ paymentId: "p_other", status: "pending" }],
    });
    expect(result.eligible).toBe(true);
  });
});

describe("CancelRequestSchema", () => {
  it("без тела → ok", () => {
    expect(CancelRequestSchema.safeParse({}).success).toBe(true);
  });

  it("reason 1 символ → ok (короткое тоже разрешено)", () => {
    expect(CancelRequestSchema.safeParse({ reason: "А" }).success).toBe(true);
  });

  it("reason 500 символов → ok (граница)", () => {
    expect(CancelRequestSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
  });

  it("reason 501 → fail с reason_too_long", () => {
    const r = CancelRequestSchema.safeParse({ reason: "x".repeat(501) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_long");
  });

  it("посторонние поля (strict) → fail", () => {
    expect(CancelRequestSchema.safeParse({ reason: "ok", malicious: true }).success).toBe(false);
  });

  it("reason: 42 (number) → fail", () => {
    expect(CancelRequestSchema.safeParse({ reason: 42 }).success).toBe(false);
  });
});
