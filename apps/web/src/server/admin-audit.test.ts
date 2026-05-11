/**
 * P6-T8 follow-up (c): Pure-helpers для admin-audit — querystring sanitize.
 */

import { describe, expect, it } from "vitest";

import { parseAdminAuditQuery } from "./admin-audit";

describe("parseAdminAuditQuery", () => {
  it("пустые → defaults", () => {
    expect(parseAdminAuditQuery({})).toEqual({
      group: null,
      q: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("undefined → defaults", () => {
    expect(parseAdminAuditQuery(undefined)).toEqual({
      group: null,
      q: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("happy: group + q + from/to + page", () => {
    const r = parseAdminAuditQuery({
      group: "user",
      q: "role_change",
      from: "2026-04-01",
      to: "2026-04-30",
      page: "3",
    });
    expect(r.group).toBe("user");
    expect(r.q).toBe("role_change");
    expect(r.from?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-04-30T23:59:59.999Z");
    expect(r.page).toBe(3);
  });

  it("неизвестный group → null", () => {
    expect(parseAdminAuditQuery({ group: "bogus" }).group).toBeNull();
  });

  it("from > to → оба обнуляются", () => {
    const r = parseAdminAuditQuery({ from: "2026-05-01", to: "2026-04-01" });
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });

  it("from с мусорным форматом → null", () => {
    expect(parseAdminAuditQuery({ from: "not-a-date" }).from).toBeNull();
  });

  it("page нечисло → 1", () => {
    expect(parseAdminAuditQuery({ page: "abc" }).page).toBe(1);
    expect(parseAdminAuditQuery({ page: "0" }).page).toBe(1);
    expect(parseAdminAuditQuery({ page: "-5" }).page).toBe(1);
  });

  it("q обрезается до 100", () => {
    const long = "x".repeat(200);
    expect(parseAdminAuditQuery({ q: long }).q?.length).toBe(100);
  });

  it("array values → берём первый", () => {
    expect(parseAdminAuditQuery({ group: ["user", "order"] }).group).toBe("user");
  });
});
