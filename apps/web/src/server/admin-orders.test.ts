/**
 * P6-T5: state-machine + querystring parser + Zod schema.
 */

import type { OrderStatus } from "@bigmax/db";
import { describe, expect, it } from "vitest";

import {
  OrderBulkStatusSchema,
  OrderStatusChangeSchema,
  allowedTransitionsFrom,
  canTransitionOrderStatus,
  parseAdminOrderListQuery,
} from "./admin-orders";

describe("canTransitionOrderStatus", () => {
  const allowed: Array<[OrderStatus, OrderStatus]> = [
    ["pending", "confirmed"],
    ["pending", "cancelled"],
    ["confirmed", "packing"],
    ["confirmed", "cancelled"],
    ["packing", "shipped"],
    ["packing", "cancelled"],
    ["shipped", "delivered"],
    ["shipped", "cancelled"],
    ["delivered", "refunded"],
  ];

  it.each(allowed)("%s → %s = true", (from, to) => {
    expect(canTransitionOrderStatus(from, to)).toBe(true);
  });

  const forbidden: Array<[OrderStatus, OrderStatus]> = [
    ["pending", "packing"],
    ["pending", "shipped"],
    ["pending", "delivered"],
    ["pending", "refunded"],
    ["confirmed", "shipped"],
    ["confirmed", "delivered"],
    ["packing", "delivered"],
    ["shipped", "refunded"],
    ["delivered", "cancelled"],
    ["delivered", "shipped"],
    ["cancelled", "pending"],
    ["cancelled", "confirmed"],
    ["refunded", "pending"],
    ["refunded", "delivered"],
  ];

  it.each(forbidden)("%s → %s = false", (from, to) => {
    expect(canTransitionOrderStatus(from, to)).toBe(false);
  });

  it("self-transition всегда запрещён", () => {
    const all: OrderStatus[] = [
      "pending",
      "confirmed",
      "packing",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
    ];
    for (const s of all) {
      expect(canTransitionOrderStatus(s, s)).toBe(false);
    }
  });
});

describe("allowedTransitionsFrom", () => {
  it("pending → [confirmed, cancelled]", () => {
    expect(allowedTransitionsFrom("pending")).toEqual(["confirmed", "cancelled"]);
  });

  it("delivered → [refunded]", () => {
    expect(allowedTransitionsFrom("delivered")).toEqual(["refunded"]);
  });

  it("cancelled терминальный — пустой массив", () => {
    expect(allowedTransitionsFrom("cancelled")).toEqual([]);
  });

  it("refunded терминальный — пустой массив", () => {
    expect(allowedTransitionsFrom("refunded")).toEqual([]);
  });
});

describe("OrderStatusChangeSchema", () => {
  it("happy: status only → ok", () => {
    expect(OrderStatusChangeSchema.safeParse({ status: "confirmed" }).success).toBe(true);
  });

  it("status + reason → ok", () => {
    const r = OrderStatusChangeSchema.safeParse({
      status: "cancelled",
      reason: "Товар закончился на складе",
    });
    expect(r.success).toBe(true);
  });

  it("неизвестный status → fail", () => {
    expect(OrderStatusChangeSchema.safeParse({ status: "bogus" }).success).toBe(false);
  });

  it("reason > 500 символов → fail", () => {
    const reason = "x".repeat(501);
    expect(OrderStatusChangeSchema.safeParse({ status: "cancelled", reason }).success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    expect(OrderStatusChangeSchema.safeParse({ status: "confirmed", extra: 1 }).success).toBe(
      false,
    );
  });

  it("reason пробелы триммятся", () => {
    const r = OrderStatusChangeSchema.safeParse({ status: "confirmed", reason: "   ok   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("ok");
  });
});

describe("parseAdminOrderListQuery", () => {
  it("пустые → defaults", () => {
    const r = parseAdminOrderListQuery({});
    expect(r).toEqual({ q: null, status: null, from: null, to: null, page: 1 });
  });

  it("undefined → defaults", () => {
    expect(parseAdminOrderListQuery(undefined)).toEqual({
      q: null,
      status: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("q + status + page → parsed", () => {
    const r = parseAdminOrderListQuery({ q: "ORD-123", status: "confirmed", page: "2" });
    expect(r).toEqual({ q: "ORD-123", status: "confirmed", from: null, to: null, page: 2 });
  });

  it("from/to ISO → start/end of UTC day", () => {
    const r = parseAdminOrderListQuery({ from: "2026-04-01", to: "2026-04-30" });
    expect(r.from?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-04-30T23:59:59.999Z");
  });

  it("from > to → оба обнуляются", () => {
    const r = parseAdminOrderListQuery({ from: "2026-05-01", to: "2026-04-01" });
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });

  it("from/to с мусорным форматом → null", () => {
    const r = parseAdminOrderListQuery({ from: "not-a-date", to: "01.04.2026" });
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });

  it("только from (без to) → from set, to null", () => {
    const r = parseAdminOrderListQuery({ from: "2026-04-01" });
    expect(r.from).not.toBeNull();
    expect(r.to).toBeNull();
  });

  it("неизвестный status → null", () => {
    const r = parseAdminOrderListQuery({ status: "bogus" });
    expect(r.status).toBeNull();
  });

  it("page нечисло → 1", () => {
    expect(parseAdminOrderListQuery({ page: "abc" }).page).toBe(1);
  });

  it("page отрицательный → 1", () => {
    expect(parseAdminOrderListQuery({ page: "-5" }).page).toBe(1);
  });

  it("page = 0 → 1", () => {
    expect(parseAdminOrderListQuery({ page: "0" }).page).toBe(1);
  });

  it("q пустая строка → null", () => {
    expect(parseAdminOrderListQuery({ q: "   " }).q).toBeNull();
  });

  it("q триммится и обрезается до 100", () => {
    const long = "x".repeat(200);
    const r = parseAdminOrderListQuery({ q: long });
    expect(r.q?.length).toBe(100);
  });

  it("array values → берём первый", () => {
    const r = parseAdminOrderListQuery({ status: ["confirmed", "shipped"] });
    expect(r.status).toBe("confirmed");
  });
});

describe("OrderBulkStatusSchema", () => {
  it("happy: 1 id → ok", () => {
    expect(OrderBulkStatusSchema.safeParse({ ids: ["a"], status: "confirmed" }).success).toBe(true);
  });

  it("ids + status + reason → ok", () => {
    const r = OrderBulkStatusSchema.safeParse({
      ids: ["a", "b", "c"],
      status: "shipped",
      reason: "Все упаковали",
    });
    expect(r.success).toBe(true);
  });

  it("пустой ids → fail", () => {
    expect(OrderBulkStatusSchema.safeParse({ ids: [], status: "confirmed" }).success).toBe(false);
  });

  it("ids > 200 → fail", () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    expect(OrderBulkStatusSchema.safeParse({ ids, status: "confirmed" }).success).toBe(false);
  });

  it("неизвестный status → fail", () => {
    expect(OrderBulkStatusSchema.safeParse({ ids: ["a"], status: "bogus" }).success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    expect(
      OrderBulkStatusSchema.safeParse({
        ids: ["a"],
        status: "confirmed",
        bulk: true,
      }).success,
    ).toBe(false);
  });

  it("reason > 500 → fail", () => {
    const reason = "x".repeat(501);
    expect(
      OrderBulkStatusSchema.safeParse({ ids: ["a"], status: "confirmed", reason }).success,
    ).toBe(false);
  });
});
