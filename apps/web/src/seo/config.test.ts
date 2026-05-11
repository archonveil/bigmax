import { BRAND } from "@bigmax/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { absoluteUrl, languageAlternates, siteUrl } from "./config";

describe("siteUrl", () => {
  const original = process.env["NEXT_PUBLIC_SITE_URL"];
  afterEach(() => {
    if (original === undefined) delete process.env["NEXT_PUBLIC_SITE_URL"];
    else process.env["NEXT_PUBLIC_SITE_URL"] = original;
  });

  it("uses NEXT_PUBLIC_SITE_URL when set, stripping trailing slash", () => {
    process.env["NEXT_PUBLIC_SITE_URL"] = "https://staging.bigmax.uz/";
    expect(siteUrl()).toBe("https://staging.bigmax.uz");
  });

  it("falls back to BRAND.url when env is empty", () => {
    process.env["NEXT_PUBLIC_SITE_URL"] = "   ";
    expect(siteUrl()).toBe(BRAND.url.replace(/\/+$/, ""));
  });

  it("falls back to BRAND.url when env is absent", () => {
    delete process.env["NEXT_PUBLIC_SITE_URL"];
    expect(siteUrl()).toBe(BRAND.url.replace(/\/+$/, ""));
  });
});

describe("absoluteUrl", () => {
  beforeEach(() => {
    process.env["NEXT_PUBLIC_SITE_URL"] = "https://bigmax.uz";
  });

  it("prefixes locale for root path", () => {
    expect(absoluteUrl("/", "ru")).toBe("https://bigmax.uz/ru");
  });

  it("prefixes locale + normalized path", () => {
    expect(absoluteUrl("/catalog/clothing", "uz")).toBe("https://bigmax.uz/uz/catalog/clothing");
    // Leading slash auto-added, trailing removed.
    expect(absoluteUrl("catalog/clothing/", "en")).toBe("https://bigmax.uz/en/catalog/clothing");
  });
});

describe("languageAlternates", () => {
  beforeEach(() => {
    process.env["NEXT_PUBLIC_SITE_URL"] = "https://bigmax.uz";
  });

  it("produces ru/uz/en + x-default→ru for any path", () => {
    expect(languageAlternates("/catalog/clothing")).toEqual({
      ru: "https://bigmax.uz/ru/catalog/clothing",
      uz: "https://bigmax.uz/uz/catalog/clothing",
      en: "https://bigmax.uz/en/catalog/clothing",
      "x-default": "https://bigmax.uz/ru/catalog/clothing",
    });
  });

  it("handles root path", () => {
    const alt = languageAlternates("/");
    expect(alt["x-default"]).toBe("https://bigmax.uz/ru");
    expect(alt["en"]).toBe("https://bigmax.uz/en");
  });
});
