import { type Locale } from "@bigmax/shared-types";
import { getTranslations } from "next-intl/server";

import { ProductCard } from "@/components/catalog/product-card";
import { getFeaturedProducts } from "@/server/catalog";

interface FeaturedProductsProps {
  locale: Locale;
}

export async function FeaturedProducts({
  locale,
}: FeaturedProductsProps): Promise<JSX.Element | null> {
  const products = await getFeaturedProducts(6);
  if (products.length === 0) return null;

  const t = await getTranslations("home");

  return (
    <section className="container py-12">
      <h2 className="mb-8 text-center text-2xl font-semibold">{t("featuredTitle")}</h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
        {products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
