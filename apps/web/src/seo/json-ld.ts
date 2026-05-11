import { BRAND, centsToDecimalString, type Locale } from "@bigmax/shared-types";

import { absoluteUrl, siteUrl } from "./config";

/**
 * Все билдеры возвращают plain-объекты, пригодные к `JSON.stringify` →
 * рендерятся через `<script type="application/ld+json">`. Любые поля
 * `undefined` опускаем (Google мягче реагирует на отсутствие полей, чем
 * на `null`/пустые строки).
 */

export interface LdNode {
  "@context": "https://schema.org";
  "@type": string;
  [k: string]: unknown;
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as T;
}

/** Organization — один раз в root-layout. */
export function organizationLd(): LdNode {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.nameRu,
    alternateName: BRAND.nameLatin,
    url: siteUrl(),
    logo: `${siteUrl()}/product-placeholder.svg`,
    email: BRAND.email,
    sameAs: [
      `https://t.me/${BRAND.telegramChannel.replace(/^@/, "")}`,
      `https://instagram.com/${BRAND.instagram.replace(/^@/, "")}`,
    ],
  };
}

/** WebSite + SearchAction — для SERP sitelinks searchbox. */
export function websiteLd(locale: Locale): LdNode {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: BRAND.nameRu,
    url: absoluteUrl("/", locale),
    inLanguage: locale,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${absoluteUrl("/search", locale)}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Путь без локали. */
  path: string;
}

export function breadcrumbLd(items: BreadcrumbItem[], locale: Locale): LdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path, locale),
    })),
  };
}

export interface ItemListEntry {
  name: string;
  /** Путь без локали. */
  path: string;
}

export function itemListLd(items: ItemListEntry[], locale: Locale): LdNode {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(it.path, locale),
      name: it.name,
    })),
  };
}

export interface ProductLdInput {
  name: string;
  description?: string | null;
  slug: string;
  brand?: string | null;
  images: string[];
  variants: Array<{
    sku: string;
    priceCents: number;
    stockQuantity: number;
  }>;
  locale: Locale;
}

/**
 * Product + AggregateOffer (если вариантов ≥2) либо один Offer.
 * Валюта — UZS; availability по max stock среди вариантов.
 */
export function productLd(p: ProductLdInput): LdNode {
  const prices = p.variants.map((v) => v.priceCents);
  const anyInStock = p.variants.some((v) => v.stockQuantity > 0);
  const availability = anyInStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const base: Record<string, unknown> = compact({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description ?? undefined,
    sku: p.variants[0]?.sku,
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    image: p.images.length > 0 ? p.images : undefined,
    url: absoluteUrl(`/product/${p.slug}`, p.locale),
  });

  if (p.variants.length === 1) {
    const v = p.variants[0]!;
    base["offers"] = {
      "@type": "Offer",
      price: centsToDecimalString(v.priceCents),
      priceCurrency: "UZS",
      availability,
      url: absoluteUrl(`/product/${p.slug}`, p.locale),
    };
  } else if (p.variants.length > 1) {
    base["offers"] = {
      "@type": "AggregateOffer",
      offerCount: p.variants.length,
      lowPrice: centsToDecimalString(Math.min(...prices)),
      highPrice: centsToDecimalString(Math.max(...prices)),
      priceCurrency: "UZS",
      availability,
      url: absoluteUrl(`/product/${p.slug}`, p.locale),
    };
  }

  return base as LdNode;
}
