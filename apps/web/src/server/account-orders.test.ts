/**
 * P5-T1: pure-парсер querystring для /account/orders.
 * Server fetch (`getUserOrders`) бьёт в реальную БД, его покрывает e2e
 * (`account-orders.spec.ts`); здесь — только нормализация query-param'ов.
 */

import { describe, expect, it } from "vitest";

import { ORDER_STATUSES, parseOrderListQuery } from "./account-orders";

describe("parseOrderListQuery · status", () => {
  it("undefined searchParams → status null, page 1", () => {
    expect(parseOrderListQuery(undefined)).toEqual({ status: null, page: 1 });
  });

  it("пустой объект → дефолт", () => {
    expect(parseOrderListQuery({})).toEqual({ status: null, page: 1 });
  });

  it("?status= (пустая строка) → null", () => {
    expect(parseOrderListQuery({ status: "" })).toEqual({ status: null, page: 1 });
  });

  it.each(ORDER_STATUSES)("?status=%s → пропускает enum-значение", (status) => {
    expect(parseOrderListQuery({ status })).toEqual({ status, page: 1 });
  });

  it("?status=garbage → null (не разрешаем неизвестные)", () => {
    expect(parseOrderListQuery({ status: "garbage" })).toEqual({ status: null, page: 1 });
  });

  it("?status=PENDING (case-sensitive) → null — Prisma enum lowercase", () => {
    expect(parseOrderListQuery({ status: "PENDING" })).toEqual({ status: null, page: 1 });
  });

  it("массив значений ?status=a&status=b — берём первый", () => {
    expect(parseOrderListQuery({ status: ["pending", "confirmed"] })).toEqual({
      status: "pending",
      page: 1,
    });
  });
});

describe("parseOrderListQuery · page", () => {
  it("?page=2 → 2", () => {
    expect(parseOrderListQuery({ page: "2" })).toEqual({ status: null, page: 2 });
  });

  it("?page=1 → 1", () => {
    expect(parseOrderListQuery({ page: "1" })).toEqual({ status: null, page: 1 });
  });

  it("?page=0 → 1 (page index 1-based)", () => {
    expect(parseOrderListQuery({ page: "0" })).toEqual({ status: null, page: 1 });
  });

  it("?page=-5 → 1 (отрицательные сбрасываются)", () => {
    expect(parseOrderListQuery({ page: "-5" })).toEqual({ status: null, page: 1 });
  });

  it("?page=abc → 1 (NaN игнорируется)", () => {
    expect(parseOrderListQuery({ page: "abc" })).toEqual({ status: null, page: 1 });
  });

  it("?page=2.7 → 2 (parseInt отбрасывает дробь)", () => {
    expect(parseOrderListQuery({ page: "2.7" })).toEqual({ status: null, page: 2 });
  });

  it("?page=999999 → 999999 (БД ограничит count'ом)", () => {
    expect(parseOrderListQuery({ page: "999999" })).toEqual({ status: null, page: 999999 });
  });
});

describe("parseOrderListQuery · комбинации", () => {
  it("status + page вместе", () => {
    expect(parseOrderListQuery({ status: "delivered", page: "3" })).toEqual({
      status: "delivered",
      page: 3,
    });
  });

  it("garbage status + valid page → status null, page применяется", () => {
    expect(parseOrderListQuery({ status: "junk", page: "5" })).toEqual({
      status: null,
      page: 5,
    });
  });
});
