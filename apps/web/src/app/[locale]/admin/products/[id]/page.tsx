/**
 * `/admin/products/[id]` — detail + edit form (P6-T3).
 *
 * Streaming: главный flush'ит form + variants как только product/dictionaries/
 * attributes готовы; stock-matrix стримится отдельно через `<Suspense>` —
 * admin может уже редактировать форму, пока stock-запрос ещё в полёте.
 */

import { isLocale, type Locale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { extractColorOptions, type AttributeOption } from "@/catalog/category-attributes";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { ProductForm } from "@/components/admin/products/product-form";
import { ProductStockHistory } from "@/components/admin/products/product-stock-history";
import { ProductStockMatrix } from "@/components/admin/products/product-stock-matrix";
import { VariantsManager } from "@/components/admin/products/variants-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminProduct, getAdminProductDictionaries } from "@/server/admin-products";
import { getAdminProductStockMatrix } from "@/server/admin-stock";
import { getCategoryAttributesMap } from "@/server/category-attributes";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
}

export default async function AdminProductDetailPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const [product, dictionaries, attributeMap] = await Promise.all([
    getAdminProduct(params.id),
    getAdminProductDictionaries(),
    getCategoryAttributesMap(),
  ]);
  if (!product) notFound();
  const attributesByCategory = Object.fromEntries(attributeMap);
  const colorOptions = extractColorOptions(attributesByCategory[product.categoryId] ?? []);

  const t = await getTranslations("admin.products.detail");

  const dateFormatted = (d: Date): string =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d);

  return (
    <div className="space-y-6" data-testid="admin-product-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "products", href: "/admin/products" }, { label: product.nameRu }]}
      />
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">{product.nameRu}</h2>
        <p className="text-xs text-muted-foreground">
          {t("createdAt", { date: dateFormatted(product.createdAt) })} ·{" "}
          {t("updatedAt", { date: dateFormatted(product.updatedAt) })}
        </p>
      </header>

      <ProductForm
        mode="edit"
        product={product}
        dictionaries={dictionaries}
        attributesByCategory={attributesByCategory}
        locale={locale}
      />

      <VariantsManager
        productId={product.id}
        productSlug={product.slug}
        variants={product.variants}
        locale={locale}
        colorOptions={colorOptions}
      />

      {/* Stock-matrix грузится последним; Suspense даёт юзеру немедленный
          skeleton, форма выше уже интерактивна. История внутри matrix —
          отдельным Suspense'ом, чтобы matrix не блокировался её запросом. */}
      <Suspense fallback={<StockMatrixSkeleton />}>
        <StockMatrixSection
          productId={product.id}
          productNameRu={product.nameRu}
          variants={product.variants}
          locale={locale}
          colorOptions={colorOptions}
        />
      </Suspense>
    </div>
  );
}

async function StockMatrixSection({
  productId,
  productNameRu,
  variants,
  locale,
  colorOptions,
}: {
  productId: string;
  productNameRu: string;
  variants: Awaited<ReturnType<typeof getAdminProduct>> extends infer P
    ? P extends { variants: infer V }
      ? V
      : never
    : never;
  locale: Locale;
  colorOptions: readonly AttributeOption[];
}): Promise<JSX.Element> {
  const matrix = await getAdminProductStockMatrix(productId);
  return (
    <ProductStockMatrix
      productNameRu={productNameRu}
      variants={variants}
      matrix={matrix}
      locale={locale}
      colorOptions={colorOptions}
      history={
        <Suspense fallback={<StockHistorySkeleton />}>
          <ProductStockHistory productId={productId} locale={locale} />
        </Suspense>
      }
    />
  );
}

function StockHistorySkeleton(): JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-busy>
      <div className="space-y-2 border-b pb-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-md border p-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}

function StockMatrixSkeleton(): JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-busy>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="h-3 w-72" />
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-md border">
            <Skeleton className="h-9 w-full rounded-b-none" />
            <div className="grid divide-x sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-7 w-12" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function intlLocale(locale: Locale): string {
  switch (locale) {
    case "ru":
      return "ru-RU";
    case "uz":
      return "uz-UZ";
    case "en":
      return "en-US";
  }
}
