import { formatCurrencyUzs, isLocale, localized, type Locale } from "@bigmax/shared-types";
import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { extractColorOptions } from "@/catalog/category-attributes";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AttributesTable } from "@/components/product/attributes-table";
import { ProductMediaSection } from "@/components/product/product-media-section";
import { ReviewsSection } from "@/components/product/reviews-section";
import { absoluteUrl, languageAlternates } from "@/seo/config";
import { breadcrumbLd, productLd } from "@/seo/json-ld";
import { JsonLd } from "@/seo/json-ld-script";
import { getProductBySlug } from "@/server/catalog";
import { getCategoryAttributes } from "@/server/category-attributes";

interface ProductPageProps {
  params: { locale: string; slug: string };
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const product = await getProductBySlug(params.slug);
  if (!product) return {};
  const locale = params.locale as Locale;
  const name = localized(product, "name", locale);
  const description = localized(product, "description", locale);
  const minPrice =
    product.variants.length > 0 ? Math.min(...product.variants.map((v) => v.priceCents)) : 0;
  const priceText = formatCurrencyUzs(minPrice, locale);
  const brand = product.brand?.name ?? null;

  const t = await getTranslations({ locale: params.locale, namespace: "seo.product" });
  const metaDescription = brand
    ? t("descriptionWithBrand", { name, brand, price: priceText })
    : t("description", { name, price: priceText });

  const url = absoluteUrl(`/product/${product.slug}`, locale);
  const primaryImage = product.images[0]?.url;

  return {
    title: t("title", { name }),
    description: description ?? metaDescription,
    alternates: {
      canonical: url,
      languages: languageAlternates(`/product/${product.slug}`),
    },
    openGraph: {
      type: "website",
      title: name,
      description: description ?? metaDescription,
      url,
      ...(primaryImage ? { images: [{ url: primaryImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description: description ?? metaDescription,
      ...(primaryImage ? { images: [primaryImage] } : {}),
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const locale = params.locale as Locale;
  const product = await getProductBySlug(params.slug);
  if (!product) notFound();

  const [t, tCatalog, tNav, attributeConfigs] = await Promise.all([
    getTranslations("product"),
    getTranslations("catalog"),
    getTranslations("nav"),
    getCategoryAttributes(product.category.id),
  ]);
  const name = localized(product, "name", locale);
  const description = localized(product, "description", locale);

  // Multi-level breadcrumb: используем полную цепочку предков из
  // `product.category.ancestors` вместо только-parent'а.
  const breadcrumbItems = [
    { name: tCatalog("indexTitle"), path: "/catalog" },
    ...product.category.ancestors.map((a) => ({
      name: localized(a, "name", locale),
      path: `/catalog/${a.slug}`,
    })),
    {
      name: localized(product.category, "name", locale),
      path: `/catalog/${product.category.slug}`,
    },
    { name, path: `/product/${product.slug}` },
  ];
  const jsonLd = [
    breadcrumbLd(breadcrumbItems, locale),
    productLd({
      name,
      description,
      slug: product.slug,
      brand: product.brand?.name ?? null,
      images: product.images.map((im) => im.url),
      variants: product.variants.map((v) => ({
        sku: v.sku,
        priceCents: v.priceCents,
        stockQuantity: v.stockQuantity,
      })),
      locale,
    }),
  ];

  return (
    <section className="container py-10">
      <Breadcrumbs
        homeLabel={tNav("home")}
        className="mb-6"
        items={[
          { href: "/catalog", label: tCatalog("indexTitle"), icon: LayoutGrid },
          ...product.category.ancestors.map((a) => ({
            href: `/catalog/${a.slug}`,
            label: localized(a, "name", locale),
          })),
          {
            href: `/catalog/${product.category.slug}`,
            label: localized(product.category, "name", locale),
          },
          { label: name },
        ]}
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
        {/* <ProductMediaSection> — client wrapper, держит selectedVariantId
            state и фильтрует галерею по выбранному варианту (variant-level
            картинки приоритетны, fallback на product-level). См. компонент
            для filter-logic. */}
        <ProductMediaSection
          product={{
            id: product.id,
            slug: product.slug,
            nameRu: product.nameRu,
            nameUz: product.nameUz,
            nameEn: product.nameEn,
            brandName: product.brand?.name ?? null,
            imageUrl: product.images[0]?.url ?? null,
          }}
          variants={product.variants}
          images={product.images}
          name={name}
          locale={locale}
          colorOptions={extractColorOptions(attributeConfigs)}
        />
      </div>

      {description ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-semibold">{t("description")}</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </section>
      ) : null}

      <AttributesTable product={product} locale={locale} attributeConfigs={attributeConfigs} />

      <ReviewsSection />

      <JsonLd data={jsonLd} />
    </section>
  );
}
