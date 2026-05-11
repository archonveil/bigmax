import { describe, expect, it } from "vitest";

import { buildOtpSmsText } from "./otp";

describe("buildOtpSmsText", () => {
  it("interpolates the code for each locale", async () => {
    const ru = await buildOtpSmsText("ru", "123456");
    const uz = await buildOtpSmsText("uz", "123456");
    const en = await buildOtpSmsText("en", "123456");

    expect(ru).toContain("123456");
    expect(ru).toMatch(/Бигмах/i);

    expect(uz).toContain("123456");
    expect(uz).toMatch(/Bigmax/i);

    expect(en).toContain("123456");
    expect(en).toMatch(/Bigmax/i);
  });

  it("falls back to ru for unknown locale", async () => {
    const fallback = await buildOtpSmsText("fr", "999999");
    const ru = await buildOtpSmsText("ru", "999999");
    expect(fallback).toBe(ru);
  });

  it("produces different messages per locale", async () => {
    const ru = await buildOtpSmsText("ru", "111111");
    const uz = await buildOtpSmsText("uz", "111111");
    const en = await buildOtpSmsText("en", "111111");
    expect(new Set([ru, uz, en]).size).toBe(3);
  });
});
