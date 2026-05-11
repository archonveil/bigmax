import { describe, expect, it } from "vitest";

import { formatPhone, isValidUzPhone, toE164 } from "./phone";

describe("toE164", () => {
  it("normalizes plain 9 digits", () => {
    expect(toE164("901234567")).toBe("+998901234567");
  });

  it("normalizes with 998 prefix (no plus)", () => {
    expect(toE164("998901234567")).toBe("+998901234567");
  });

  it("strips spaces, dashes, parens", () => {
    expect(toE164("+998 (90) 123-45-67")).toBe("+998901234567");
    expect(toE164("998-90-123-4567")).toBe("+998901234567");
  });

  it("returns null when 9 digits can't be extracted", () => {
    expect(toE164("1234")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164("abc")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats to +998 XX XXX-XX-XX", () => {
    expect(formatPhone("+998901234567")).toBe("+998 90 123-45-67");
    expect(formatPhone("901234567")).toBe("+998 90 123-45-67");
  });

  it("returns input as-is when unparseable", () => {
    expect(formatPhone("garbage")).toBe("garbage");
  });
});

describe("isValidUzPhone", () => {
  it("requires canonical E.164 +998 + 9 digits", () => {
    expect(isValidUzPhone("+998901234567")).toBe(true);
    expect(isValidUzPhone("998901234567")).toBe(false);
    expect(isValidUzPhone("+998 90 123 45 67")).toBe(false);
    expect(isValidUzPhone("+99890123456")).toBe(false);
  });
});
