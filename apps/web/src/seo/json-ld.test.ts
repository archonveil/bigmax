import { beforeEach, describe, expect, it } from "vitest";

import { breadcrumbLd, itemListLd, organizationLd, productLd, websiteLd } from "./json-ld";

beforeEach(() => {
  process.env["NEXT_PUBLIC_SITE_URL"] = "https://bigmax.uz";
});

describe("organizationLd", () => {
  it("has Organization shape with brand identity", () => {
    const ld = organizationLd();
    expect(ld["@type"]).toBe("Organization");
    expect(ld["name"]).toBe("Бигмах");
    expect(ld["alternateName"]).toBe("Bigmax");
    expect(ld["url"]).toBe("https://bigmax.uz");
    expect(ld["sameAs"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("t.me/"),
        expect.stringContaining("instagram.com/"),
      ]),
    );
  });
});

describe("websiteLd", () => {
  it("includes SearchAction template pointing at /search?q=", () => {
    const ld = websiteLd("ru");
    expect(ld["@type"]).toBe("WebSite");
    expect(ld["inLanguage"]).toBe("ru");
    expect(ld["potentialAction"]).toMatchObject({
      "@type": "SearchAction",
      target: {
        urlTemplate: "https://bigmax.uz/ru/search?q={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    });
  });
});

describe("breadcrumbLd", () => {
  it("builds numbered ListItems with absolute URLs", () => {
    const ld = breadcrumbLd(
      [
        { name: "Каталог", path: "/catalog" },
        { name: "Одежда", path: "/catalog/clothing" },
      ],
      "ru",
    );
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld["itemListElement"]).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Каталог",
        item: "https://bigmax.uz/ru/catalog",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Одежда",
        item: "https://bigmax.uz/ru/catalog/clothing",
      },
    ]);
  });
});

describe("itemListLd", () => {
  it("builds numbered ListItems with url+name", () => {
    const ld = itemListLd(
      [
        { name: "Product A", path: "/product/a" },
        { name: "Product B", path: "/product/b" },
      ],
      "en",
    );
    expect(ld["@type"]).toBe("ItemList");
    expect(ld["itemListElement"]).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        url: "https://bigmax.uz/en/product/a",
        name: "Product A",
      },
      {
        "@type": "ListItem",
        position: 2,
        url: "https://bigmax.uz/en/product/b",
        name: "Product B",
      },
    ]);
  });
});

describe("productLd", () => {
  const base = {
    name: "Подгузники Pampers",
    description: "Мягкие подгузники",
    slug: "pampers",
    brand: "Pampers",
    images: ["https://cdn/1.jpg"],
    locale: "ru" as const,
  };

  it("single variant → Offer", () => {
    const ld = productLd({
      ...base,
      variants: [{ sku: "P-1", priceCents: 18_500_000, stockQuantity: 40 }],
    });
    expect(ld["@type"]).toBe("Product");
    expect(ld["sku"]).toBe("P-1");
    expect(ld["brand"]).toEqual({ "@type": "Brand", name: "Pampers" });
    expect(ld["image"]).toEqual(["https://cdn/1.jpg"]);
    expect(ld["url"]).toBe("https://bigmax.uz/ru/product/pampers");
    expect(ld["offers"]).toEqual({
      "@type": "Offer",
      price: "185000.00",
      priceCurrency: "UZS",
      availability: "https://schema.org/InStock",
      url: "https://bigmax.uz/ru/product/pampers",
    });
  });

  it("multi-variant → AggregateOffer (low/high range)", () => {
    const ld = productLd({
      ...base,
      variants: [
        { sku: "P-1", priceCents: 18_500_000, stockQuantity: 40 },
        { sku: "P-2", priceCents: 34_900_000, stockQuantity: 22 },
      ],
    });
    expect(ld["offers"]).toEqual({
      "@type": "AggregateOffer",
      offerCount: 2,
      lowPrice: "185000.00",
      highPrice: "349000.00",
      priceCurrency: "UZS",
      availability: "https://schema.org/InStock",
      url: "https://bigmax.uz/ru/product/pampers",
    });
  });

  it("all variants out of stock → OutOfStock", () => {
    const ld = productLd({
      ...base,
      variants: [
        { sku: "X-1", priceCents: 10_000, stockQuantity: 0 },
        { sku: "X-2", priceCents: 20_000, stockQuantity: 0 },
      ],
    });
    expect((ld["offers"] as Record<string, string>)["availability"]).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("omits brand/description/image when absent (compact)", () => {
    const ld = productLd({
      name: "x",
      description: null,
      slug: "x",
      brand: null,
      images: [],
      variants: [{ sku: "X", priceCents: 100, stockQuantity: 1 }],
      locale: "ru",
    });
    expect(ld["brand"]).toBeUndefined();
    expect(ld["description"]).toBeUndefined();
    expect(ld["image"]).toBeUndefined();
  });
});
