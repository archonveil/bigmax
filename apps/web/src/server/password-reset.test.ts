/**
 * P6-T8 follow-up (b): Pure-helpers для password-reset.
 */

import { compare } from "bcryptjs";
import { describe, expect, it } from "vitest";

import {
  PasswordResetCompleteSchema,
  PasswordResetRequestSchema,
  computeExpiresAt,
  generateResetToken,
  parseCompoundToken,
  verifyResetToken,
} from "./password-reset";

describe("PasswordResetRequestSchema", () => {
  it("happy: lowercase email + trim", () => {
    const r = PasswordResetRequestSchema.safeParse({ email: "  USER@Example.COM  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("user@example.com");
  });

  it("invalid email → fail", () => {
    expect(PasswordResetRequestSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("strict: extra fields → fail", () => {
    expect(PasswordResetRequestSchema.safeParse({ email: "u@e.com", password: "x" }).success).toBe(
      false,
    );
  });
});

describe("PasswordResetCompleteSchema", () => {
  const validToken = "abcdefgh.deadbeef1234567890abcdef";

  it("happy", () => {
    expect(
      PasswordResetCompleteSchema.safeParse({
        token: validToken,
        password: "newPass1234",
      }).success,
    ).toBe(true);
  });

  it("password < 8 → password_too_short", () => {
    const r = PasswordResetCompleteSchema.safeParse({
      token: validToken,
      password: "short1",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("password_too_short");
  });

  it("token без точки → invalid_token", () => {
    const r = PasswordResetCompleteSchema.safeParse({
      token: "no-dot-here",
      password: "validpass",
    });
    expect(r.success).toBe(false);
  });

  it("strict: extra → fail", () => {
    expect(
      PasswordResetCompleteSchema.safeParse({
        token: validToken,
        password: "validpass",
        email: "u@e.com",
      }).success,
    ).toBe(false);
  });
});

describe("generateResetToken", () => {
  it("plain — 64-char hex, hash — bcrypt", async () => {
    const { plain, hash } = await generateResetToken();
    expect(plain).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("hash валидируется через bcrypt.compare", async () => {
    const { plain, hash } = await generateResetToken();
    expect(await compare(plain, hash)).toBe(true);
    expect(await compare("wrong", hash)).toBe(false);
  });

  it("разные вызовы → разные plain'ы", async () => {
    const a = await generateResetToken();
    const b = await generateResetToken();
    expect(a.plain).not.toBe(b.plain);
  });
});

describe("parseCompoundToken", () => {
  it("happy: tokenId.plain", () => {
    const r = parseCompoundToken("clz1.deadbeef");
    expect(r).toEqual({ tokenId: "clz1", plain: "deadbeef" });
  });

  it("без точки → null", () => {
    expect(parseCompoundToken("nodot")).toBeNull();
  });

  it("с точкой в конце → null", () => {
    expect(parseCompoundToken("nodot.")).toBeNull();
  });

  it("с точкой в начале → null", () => {
    expect(parseCompoundToken(".plain")).toBeNull();
  });

  it("с несколькими точками → берём первую как separator", () => {
    const r = parseCompoundToken("clz1.dead.beef");
    expect(r).toEqual({ tokenId: "clz1", plain: "dead.beef" });
  });
});

describe("verifyResetToken", () => {
  it("plain matches hash → true", async () => {
    const { plain, hash } = await generateResetToken();
    expect(await verifyResetToken(plain, hash)).toBe(true);
  });

  it("plain mismatch → false", async () => {
    const { hash } = await generateResetToken();
    expect(await verifyResetToken("wrong-token", hash)).toBe(false);
  });
});

describe("computeExpiresAt", () => {
  it("ровно +30 минут от now", () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const exp = computeExpiresAt(now);
    expect(exp.toISOString()).toBe("2026-05-07T12:30:00.000Z");
  });
});
