import { describe, expect, it } from "vitest";

import { buildOrderNumber, isOrderNumber, parseOrderNumber } from "./order-number";

describe("buildOrderNumber", () => {
  const date = new Date(Date.UTC(2026, 3, 21)); // 21 Apr 2026 UTC

  it("produces BGX-YYYYMMDD-NNNN", () => {
    expect(buildOrderNumber(date, 1)).toBe("BGX-20260421-0001");
    expect(buildOrderNumber(date, 42)).toBe("BGX-20260421-0042");
    expect(buildOrderNumber(date, 9999)).toBe("BGX-20260421-9999");
  });

  it("throws on out-of-range sequence", () => {
    expect(() => buildOrderNumber(date, 0)).toThrow(RangeError);
    expect(() => buildOrderNumber(date, 10000)).toThrow(RangeError);
    expect(() => buildOrderNumber(date, 1.5)).toThrow(RangeError);
    expect(() => buildOrderNumber(date, -1)).toThrow(RangeError);
  });

  it("uses UTC (no timezone drift)", () => {
    // 2026-01-01 22:00 UTC ≡ 2026-01-02 03:00 in UZT (+05) — номер всё равно 01-01.
    const utc = new Date(Date.UTC(2026, 0, 1, 22, 0, 0));
    expect(buildOrderNumber(utc, 7)).toBe("BGX-20260101-0007");
  });
});

describe("parseOrderNumber", () => {
  it("parses valid numbers", () => {
    expect(parseOrderNumber("BGX-20260421-0042")).toEqual({
      year: 2026,
      month: 4,
      day: 21,
      sequence: 42,
    });
  });

  it("rejects malformed input", () => {
    expect(parseOrderNumber("BGX-2026-04-21-0042")).toBeNull();
    expect(parseOrderNumber("BGX-20260421-42")).toBeNull();
    expect(parseOrderNumber("bgx-20260421-0042")).toBeNull();
    expect(parseOrderNumber("")).toBeNull();
  });
});

describe("isOrderNumber", () => {
  it("is a simple boolean wrapper around the regex", () => {
    expect(isOrderNumber("BGX-20260421-0001")).toBe(true);
    expect(isOrderNumber("BGX-20260421-001")).toBe(false);
  });
});
