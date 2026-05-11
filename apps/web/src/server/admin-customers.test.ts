/**
 * P6-T8: Pure helpers для admin-customers — querystring sanitize,
 * Zod-схемы (RoleChange, PasswordReset), generateTempPassword.
 */

import { describe, expect, it } from "vitest";

import {
  BlockToggleSchema,
  PasswordResetSchema,
  RoleBulkSchema,
  RoleChangeSchema,
  generateTempPassword,
  parseAdminCustomerListQuery,
} from "./admin-customers";

describe("parseAdminCustomerListQuery", () => {
  it("пустые → defaults", () => {
    expect(parseAdminCustomerListQuery({})).toEqual({ q: null, role: null, page: 1 });
  });

  it("undefined → defaults", () => {
    expect(parseAdminCustomerListQuery(undefined)).toEqual({ q: null, role: null, page: 1 });
  });

  it("happy: q + role + page", () => {
    expect(parseAdminCustomerListQuery({ q: "anna", role: "admin", page: "2" })).toEqual({
      q: "anna",
      role: "admin",
      page: 2,
    });
  });

  it("неизвестный role → null", () => {
    expect(parseAdminCustomerListQuery({ role: "bogus" }).role).toBeNull();
  });

  it("page нечисло → 1", () => {
    expect(parseAdminCustomerListQuery({ page: "abc" }).page).toBe(1);
    expect(parseAdminCustomerListQuery({ page: "-5" }).page).toBe(1);
  });

  it("q обрезается до 100", () => {
    const long = "x".repeat(200);
    expect(parseAdminCustomerListQuery({ q: long }).q?.length).toBe(100);
  });

  it("array values → берём первый", () => {
    expect(parseAdminCustomerListQuery({ role: ["admin", "manager"] }).role).toBe("admin");
  });
});

describe("RoleChangeSchema", () => {
  it("happy: role + reason", () => {
    expect(
      RoleChangeSchema.safeParse({ role: "manager", reason: "Promote to manager" }).success,
    ).toBe(true);
  });

  it("неизвестный role → fail", () => {
    expect(RoleChangeSchema.safeParse({ role: "ceo", reason: "ok ok ok" }).success).toBe(false);
  });

  it("reason < 3 → reason_too_short", () => {
    const r = RoleChangeSchema.safeParse({ role: "admin", reason: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_short");
  });

  it("reason > 500 → reason_too_long", () => {
    const r = RoleChangeSchema.safeParse({ role: "admin", reason: "x".repeat(501) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_long");
  });

  it("strict: лишние поля → fail", () => {
    expect(RoleChangeSchema.safeParse({ role: "admin", reason: "ok ok", extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("PasswordResetSchema", () => {
  it("happy: reason", () => {
    expect(PasswordResetSchema.safeParse({ reason: "Customer forgot password" }).success).toBe(
      true,
    );
  });

  it("reason < 3 → fail", () => {
    expect(PasswordResetSchema.safeParse({ reason: "ab" }).success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    expect(PasswordResetSchema.safeParse({ reason: "ok ok", role: "admin" }).success).toBe(false);
  });
});

describe("BlockToggleSchema", () => {
  it("happy: только reason", () => {
    expect(BlockToggleSchema.safeParse({ reason: "Suspicious activity detected" }).success).toBe(
      true,
    );
  });

  it("reason < 3 → fail", () => {
    expect(BlockToggleSchema.safeParse({ reason: "ab" }).success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    expect(BlockToggleSchema.safeParse({ reason: "ok ok", role: "admin" }).success).toBe(false);
  });
});

describe("RoleBulkSchema", () => {
  it("happy: 1 user → ok", () => {
    expect(
      RoleBulkSchema.safeParse({ userIds: ["a"], role: "manager", reason: "ok ok ok" }).success,
    ).toBe(true);
  });

  it("happy: many users", () => {
    expect(
      RoleBulkSchema.safeParse({
        userIds: ["a", "b", "c"],
        role: "customer",
        reason: "Demote test",
      }).success,
    ).toBe(true);
  });

  it("пустой userIds → fail", () => {
    expect(
      RoleBulkSchema.safeParse({ userIds: [], role: "manager", reason: "ok ok" }).success,
    ).toBe(false);
  });

  it("userIds > 50 → fail", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect(
      RoleBulkSchema.safeParse({ userIds: ids, role: "manager", reason: "ok ok" }).success,
    ).toBe(false);
  });

  it("неизвестный role → fail", () => {
    expect(RoleBulkSchema.safeParse({ userIds: ["a"], role: "ceo", reason: "ok ok" }).success).toBe(
      false,
    );
  });

  it("strict: лишние поля → fail", () => {
    expect(
      RoleBulkSchema.safeParse({
        userIds: ["a"],
        role: "admin",
        reason: "ok ok",
        bulk: true,
      }).success,
    ).toBe(false);
  });
});

describe("generateTempPassword", () => {
  it("default length 12", () => {
    expect(generateTempPassword().length).toBe(12);
  });

  it("custom length", () => {
    expect(generateTempPassword(20).length).toBe(20);
  });

  it("содержит только символы из safe alphabet'а (нет I/l/1/O/0)", () => {
    const pwd = generateTempPassword(100);
    expect(pwd).not.toMatch(/[Il1O0]/);
  });

  it("разные вызовы дают разные пароли (cryptographic randomness)", () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).not.toBe(b);
  });

  it("length < 4 → throw", () => {
    expect(() => generateTempPassword(3)).toThrow();
  });
});
