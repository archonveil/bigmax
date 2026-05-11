/**
 * P7-T2 sub-task G: admin-features Zod-схема + pure-validator.
 */

import { describe, expect, it } from "vitest";

import { FeatureValueUpdateSchema, validateFeatureValue } from "./admin-features";

describe("FeatureValueUpdateSchema", () => {
  it("happy: { value: string } → ok", () => {
    const r = FeatureValueUpdateSchema.safeParse({ value: "5" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.value).toBe("5");
  });

  it("trim'ит whitespace", () => {
    const r = FeatureValueUpdateSchema.safeParse({ value: "  hello  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.value).toBe("hello");
  });

  it("> 2000 chars → fail", () => {
    const r = FeatureValueUpdateSchema.safeParse({ value: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    const r = FeatureValueUpdateSchema.safeParse({ value: "5", type: "number" });
    expect(r.success).toBe(false);
  });

  it("отсутствие value → fail", () => {
    const r = FeatureValueUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("validateFeatureValue · number", () => {
  it("'1' / '0.5' / '5e2' → ok", () => {
    expect(validateFeatureValue("number", "1").ok).toBe(true);
    expect(validateFeatureValue("number", "0.5").ok).toBe(true);
    expect(validateFeatureValue("number", "5e2").ok).toBe(true);
    expect(validateFeatureValue("number", "-1.5").ok).toBe(true);
  });

  it("'abc' / 'NaN' / 'Infinity' → invalid_number", () => {
    expect(validateFeatureValue("number", "abc")).toEqual({
      ok: false,
      reason: "invalid_number",
    });
    expect(validateFeatureValue("number", "NaN")).toEqual({
      ok: false,
      reason: "invalid_number",
    });
    expect(validateFeatureValue("number", "Infinity")).toEqual({
      ok: false,
      reason: "invalid_number",
    });
  });

  it("пустая строка → invalid_number", () => {
    expect(validateFeatureValue("number", "")).toEqual({
      ok: false,
      reason: "invalid_number",
    });
  });
});

describe("validateFeatureValue · boolean", () => {
  it("'true' / 'false' → ok", () => {
    expect(validateFeatureValue("boolean", "true").ok).toBe(true);
    expect(validateFeatureValue("boolean", "false").ok).toBe(true);
  });

  it("'True' / 'TRUE' / '1' / 'yes' → invalid_boolean (case-sensitive, strict canonical)", () => {
    expect(validateFeatureValue("boolean", "True")).toEqual({
      ok: false,
      reason: "invalid_boolean",
    });
    expect(validateFeatureValue("boolean", "1")).toEqual({
      ok: false,
      reason: "invalid_boolean",
    });
    expect(validateFeatureValue("boolean", "yes")).toEqual({
      ok: false,
      reason: "invalid_boolean",
    });
  });
});

describe("validateFeatureValue · string", () => {
  it("любая → ok (включая пустую — legitimate 'off' state)", () => {
    expect(validateFeatureValue("string", "hello").ok).toBe(true);
    expect(validateFeatureValue("string", "  trailing-spaces-ok  ").ok).toBe(true);
    expect(validateFeatureValue("string", "{}").ok).toBe(true);
    // P7-T2 sub-task O: пустая строка — это «выключенный banner», не ошибка.
    expect(validateFeatureValue("string", "").ok).toBe(true);
  });
});
