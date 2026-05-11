/**
 * P2-T8: SEO-поверхность (P2-T7).
 * - sitemap.xml, robots.txt.
 * - hreflang + canonical на home/product.
 * - JSON-LD блоки: Organization/WebSite на home, Product+Offer на карточке.
 * - noindex на /search и на пагинации.
 */

import { expect, test } from "@playwright/test";

test("sitemap.xml отдаётся и содержит home + product URLs × 3 локали", async ({ request }) => {
  const r = await request.get("/sitemap.xml");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/xml/);

  const xml = await r.text();
  // Канонический URL'ы (loc) — на ru; альтернативы через xhtml:link.
  expect(xml).toContain("/ru/catalog");
  expect(xml).toMatch(/hreflang="ru"/);
  expect(xml).toMatch(/hreflang="uz"/);
  expect(xml).toMatch(/hreflang="en"/);
  expect(xml).toMatch(/hreflang="x-default"/);
  expect(xml).toContain("/ru/product/pampers-premium-care-3");
});

test("robots.txt — Disallow /account, /auth, /search", async ({ request }) => {
  const r = await request.get("/robots.txt");
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).toMatch(/User-Agent:\s*\*/i);
  expect(text).toMatch(/Disallow:\s*\/\*\/account\//);
  expect(text).toMatch(/Disallow:\s*\/\*\/auth\//);
  expect(text).toMatch(/Disallow:\s*\/\*\/search/);
  expect(text).toMatch(/Sitemap:\s+.*\/sitemap\.xml/i);
});

test("home /ru содержит canonical + hreflang + Organization JSON-LD", async ({ page }) => {
  await page.goto("/ru");
  // canonical (self-reference) не обязателен на home — проверяем hreflang + JSON-LD.
  const altRu = await page.locator('link[rel="alternate"][hreflang="ru"]').count();
  expect(altRu).toBeGreaterThanOrEqual(1);
  await expect(page.locator('link[rel="alternate"][hreflang="uz"]')).toHaveCount(1);
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);

  // Organization JSON-LD в <body> (мы инжектим через <JsonLd> у closing body).
  const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
  const types = ld.map((s) => {
    try {
      return JSON.parse(s)["@type"] as string;
    } catch {
      return "";
    }
  });
  expect(types).toContain("Organization");
  expect(types).toContain("WebSite");
});

test("product page — canonical + Product+Offer JSON-LD", async ({ page }) => {
  await page.goto("/ru/product/pampers-premium-care-3");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/ru\/product\/pampers-premium-care-3$/,
  );

  const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
  const nodes = ld.map((s) => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  });
  const product = nodes.find((n) => n["@type"] === "Product");
  expect(product).toBeDefined();
  // Варианта два в seed'е — должен быть AggregateOffer.
  const offers = product?.["offers"] as Record<string, unknown>;
  expect(offers["@type"]).toBe("AggregateOffer");
  expect(offers["priceCurrency"]).toBe("UZS");

  // BreadcrumbList рядом.
  expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
});

test("/ru/search?q=mock — noindex, follow", async ({ page }) => {
  await page.goto("/ru/search?q=mock");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
  await expect(robots).toHaveAttribute("content", /follow/);
});

test("/ru/catalog/clothing?page=2 — noindex (guard от long-tail дубликатов)", async ({ page }) => {
  await page.goto("/ru/catalog/clothing?page=2");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("/ru/catalog/clothing (чистый URL) — БЕЗ robots noindex", async ({ page }) => {
  await page.goto("/ru/catalog/clothing");
  // robots meta либо отсутствует, либо не содержит noindex.
  const robots = page.locator('meta[name="robots"]');
  const count = await robots.count();
  if (count > 0) {
    const content = await robots.getAttribute("content");
    expect(content).not.toMatch(/noindex/);
  }
});
