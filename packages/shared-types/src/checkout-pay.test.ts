import { describe, expect, it } from "vitest";

import { CheckoutPayRequestSchema } from "./checkout-pay";

const COURIER_VALID = {
  contacts: { name: "Иван Иванов", email: "ivan@example.com", phone: "+998901234567" },
  address: {
    region: "andijan",
    city: "Андижан",
    district: "",
    street: "Амира Темура",
    house: "1",
    apartment: "",
    landmark: "",
    phone: "",
  },
  delivery: { method: "courier" as const, branchId: "", comment: "" },
  payment: { method: "uniteller" as const },
  items: [{ variantId: "var-1", quantity: 2 }],
  locale: "ru" as const,
};

describe("CheckoutPayRequestSchema · happy paths", () => {
  it("accepts valid courier request", () => {
    const res = CheckoutPayRequestSchema.safeParse(COURIER_VALID);
    expect(res.success).toBe(true);
  });

  it("accepts valid pickup request (no address, has branchId)", () => {
    const res = CheckoutPayRequestSchema.safeParse({
      ...COURIER_VALID,
      address: undefined,
      delivery: { method: "pickup", branchId: "seed-branch-tashkent-main", comment: "" },
    });
    expect(res.success).toBe(true);
  });

  it("accepts optional promoCode", () => {
    const res = CheckoutPayRequestSchema.safeParse({ ...COURIER_VALID, promoCode: "WELCOME10" });
    expect(res.success).toBe(true);
  });
});

describe("CheckoutPayRequestSchema · rejection rules", () => {
  it("rejects courier without address", () => {
    const res = CheckoutPayRequestSchema.safeParse({ ...COURIER_VALID, address: undefined });
    expect(res.success).toBe(false);
  });

  it("rejects pickup without branchId", () => {
    const res = CheckoutPayRequestSchema.safeParse({
      ...COURIER_VALID,
      delivery: { method: "pickup", branchId: "", comment: "" },
    });
    expect(res.success).toBe(false);
  });

  it("rejects invalid phone format", () => {
    const res = CheckoutPayRequestSchema.safeParse({
      ...COURIER_VALID,
      contacts: { ...COURIER_VALID.contacts, phone: "8-555-111-22-33" },
    });
    expect(res.success).toBe(false);
  });

  it("rejects unknown region slug", () => {
    const res = CheckoutPayRequestSchema.safeParse({
      ...COURIER_VALID,
      address: { ...COURIER_VALID.address, region: "moscow" },
    });
    expect(res.success).toBe(false);
  });

  it("rejects unknown locale", () => {
    const res = CheckoutPayRequestSchema.safeParse({ ...COURIER_VALID, locale: "kk" });
    expect(res.success).toBe(false);
  });

  it("rejects empty items", () => {
    const res = CheckoutPayRequestSchema.safeParse({ ...COURIER_VALID, items: [] });
    expect(res.success).toBe(false);
  });

  it("rejects quantity=0", () => {
    const res = CheckoutPayRequestSchema.safeParse({
      ...COURIER_VALID,
      items: [{ variantId: "v1", quantity: 0 }],
    });
    expect(res.success).toBe(false);
  });
});
