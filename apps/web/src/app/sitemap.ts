import { LOCALES } from "@bigmax/shared-types";
import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/seo/config";
import { getCategoriesForSitemap, getProductsForSitemap } from "@/server/catalog";

/**
 * Динамический sitemap.xml: home + /catalog + все категории + все товары
 * на каждой из 3 локалей. Для каждого URL добавляем `alternates.languages`
 * с hreflang'ами (+ x-default на ru) — Google сам выберет нужную версию.
 *
 * Страницы, которые НЕ в sitemap'е: /search (user input), /auth/*,
 * /account/*, /api/* — все они покрыты `noindex` и `robots.txt` disallow.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([
    getCategoriesForSitemap(),
    getProductsForSitemap(),
  ]);
  const now = new Date();

  function entry(
    path: string,
    lastModified: Date,
    priority: number,
  ): MetadataRoute.Sitemap[number] {
    // x-default всегда → ru, прочие локали через /{locale}{path}.
    const languages: Record<string, string> = { "x-default": absoluteUrl(path, "ru") };
    for (const l of LOCALES) languages[l] = absoluteUrl(path, l);
    return {
      url: absoluteUrl(path, "ru"),
      lastModified,
      changeFrequency: "daily",
      priority,
      alternates: { languages },
    };
  }

  const staticPages: Array<{ path: string; priority: number }> = [
    { path: "/", priority: 1 },
    { path: "/catalog", priority: 0.9 },
  ];

  return [
    ...staticPages.map((p) => entry(p.path, now, p.priority)),
    ...categories.map((c) => entry(`/catalog/${c.slug}`, c.updatedAt, 0.8)),
    ...products.map((p) => entry(`/product/${p.slug}`, p.updatedAt, 0.7)),
  ];
}
