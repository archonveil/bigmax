/**
 * P6-T8 follow-up (b): password-reset email template tests.
 */

import { describe, expect, it } from "vitest";

import { buildPasswordResetEmail } from "./password-reset";

describe("buildPasswordResetEmail", () => {
  it("ru happy: subject + html + text rendered", async () => {
    const r = await buildPasswordResetEmail({
      rawLocale: "ru",
      email: "user@example.com",
      resetUrl: "https://bigmax.uz/ru/auth/password-reset/clz1.deadbeef",
    });
    expect(r.subject).toContain("Бигмах");
    expect(r.html).toContain("user@example.com");
    expect(r.html).toContain("https://bigmax.uz/ru/auth/password-reset/clz1.deadbeef");
    expect(r.text).toContain("user@example.com");
    expect(r.text).toContain("https://bigmax.uz/ru/auth/password-reset/clz1.deadbeef");
  });

  it("uz: latin alphabet rendered", async () => {
    const r = await buildPasswordResetEmail({
      rawLocale: "uz",
      email: "u@e.com",
      resetUrl: "https://bigmax.uz/uz/auth/password-reset/x.y",
    });
    expect(r.subject).toContain("Bigmax");
  });

  it("en: english", async () => {
    const r = await buildPasswordResetEmail({
      rawLocale: "en",
      email: "u@e.com",
      resetUrl: "https://bigmax.uz/en/auth/password-reset/x.y",
    });
    expect(r.subject).toContain("Bigmax");
  });

  it("неизвестный locale → fallback на ru", async () => {
    const r = await buildPasswordResetEmail({
      rawLocale: "fr",
      email: "u@e.com",
      resetUrl: "https://bigmax.uz/ru/auth/password-reset/x.y",
    });
    expect(r.subject).toContain("Бигмах");
  });

  it("HTML escapes spec-symbols в email и url", async () => {
    const r = await buildPasswordResetEmail({
      rawLocale: "en",
      email: "u<script>@e.com",
      resetUrl: 'https://bigmax.uz/en/auth/password-reset/x."y',
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&quot;y");
  });
});
