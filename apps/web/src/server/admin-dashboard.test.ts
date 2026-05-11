/**
 * P6-T2: pure-helpers admin dashboard'а.
 * Сами Prisma-агрегаты тестируются через e2e на seeded заказах.
 */

import { describe, expect, it } from "vitest";

import {
  dashboardRanges,
  LOW_STOCK_THRESHOLD,
  PENDING_UNITELLER_MIN_AGE_SEC,
  REVENUE_STATUSES,
} from "./admin-dashboard";

describe("dashboardRanges", () => {
  it("полночь сегодняшнего UTC-дня", () => {
    const now = new Date("2026-04-25T15:42:31.123Z");
    const r = dashboardRanges(now);
    expect(r.todayStart.toISOString()).toBe("2026-04-25T00:00:00.000Z");
  });

  it("week = today − 7 дней (ровно)", () => {
    const now = new Date("2026-04-25T15:42:31.123Z");
    const r = dashboardRanges(now);
    expect(r.weekStart.toISOString()).toBe("2026-04-18T00:00:00.000Z");
  });

  it("month = today − 30 дней (rolling, не календарный)", () => {
    const now = new Date("2026-04-25T15:42:31.123Z");
    const r = dashboardRanges(now);
    expect(r.monthStart.toISOString()).toBe("2026-03-26T00:00:00.000Z");
  });

  it("сразу после полуночи UTC → today совпадает с now (truncated)", () => {
    const now = new Date("2026-04-25T00:00:00.000Z");
    const r = dashboardRanges(now);
    expect(r.todayStart.getTime()).toBe(now.getTime());
  });

  it("за миг до полуночи UTC → today всё ещё текущий день", () => {
    const now = new Date("2026-04-25T23:59:59.999Z");
    const r = dashboardRanges(now);
    expect(r.todayStart.toISOString()).toBe("2026-04-25T00:00:00.000Z");
  });

  it("границы месяцев: 1 марта → month-start откатывается на январь", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const r = dashboardRanges(now);
    // 30 дней назад от 2026-03-01 = 2026-01-30
    expect(r.monthStart.toISOString()).toBe("2026-01-30T00:00:00.000Z");
  });

  it("leap year: 29 февраля 2024 → month-start корректно", () => {
    const now = new Date("2024-02-29T08:00:00.000Z");
    const r = dashboardRanges(now);
    // 30 дней назад от 2024-02-29 = 2024-01-30
    expect(r.monthStart.toISOString()).toBe("2024-01-30T00:00:00.000Z");
  });

  it("границы year: 2 января → week-start уходит в декабрь прошлого года", () => {
    const now = new Date("2026-01-02T10:00:00.000Z");
    const r = dashboardRanges(now);
    expect(r.weekStart.toISOString()).toBe("2025-12-26T00:00:00.000Z");
  });

  it("today/week/month — все в UTC, время 00:00:00.000", () => {
    const now = new Date("2026-04-25T15:42:31.123Z");
    const r = dashboardRanges(now);
    for (const d of [r.todayStart, r.weekStart, r.monthStart]) {
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
      expect(d.getUTCMilliseconds()).toBe(0);
    }
  });
});

describe("REVENUE_STATUSES — sanity", () => {
  it("включает confirmed/packing/shipped/delivered (paid funnel)", () => {
    expect(REVENUE_STATUSES).toEqual(["confirmed", "packing", "shipped", "delivered"]);
  });

  it("НЕ включает pending/cancelled/refunded", () => {
    expect(REVENUE_STATUSES).not.toContain("pending");
    expect(REVENUE_STATUSES).not.toContain("cancelled");
    expect(REVENUE_STATUSES).not.toContain("refunded");
  });
});

describe("constants", () => {
  it("LOW_STOCK_THRESHOLD ≥ 1", () => {
    expect(LOW_STOCK_THRESHOLD).toBeGreaterThanOrEqual(1);
  });

  it("PENDING_UNITELLER_MIN_AGE_SEC ≥ 60 (фильтрует только что созданные)", () => {
    expect(PENDING_UNITELLER_MIN_AGE_SEC).toBeGreaterThanOrEqual(60);
  });
});
