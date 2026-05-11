import type { MetadataRoute } from "next";

import { siteUrl } from "@/seo/config";

export default function robots(): MetadataRoute.Robots {
  const host = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/*/api/",
          "/*/account/",
          "/*/auth/",
          "/*/search",
          "/*/search/",
          "/*/cart",
          "/*/cart/",
          "/*/favorites",
          "/*/favorites/",
        ],
      },
    ],
    host,
    sitemap: `${host}/sitemap.xml`,
  };
}
