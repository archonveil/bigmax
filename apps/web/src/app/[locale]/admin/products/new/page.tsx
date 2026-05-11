/**
 * `/admin/products/new` — создание товара (P6-T3).
 */

import { isLocale, type Locale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { ProductForm } from "@/components/admin/products/product-form";
import { getAdminProductDictionaries } from "@/server/admin-products";
import { getCategoryAttributesMap } from "@/server/category-attributes";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
}

export default async function AdminProductCreatePage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const [dictionaries, attributeMap, t] = await Promise.all([
    getAdminProductDictionaries(),
    getCategoryAttributesMap(),
    getTranslations("admin.products.create"),
  ]);
  const attributesByCategory = Object.fromEntries(attributeMap);

  return (
    <div className="space-y-6" data-testid="admin-product-create">
      <AdminBreadcrumbs
        items={[{ labelKey: "products", href: "/admin/products" }, { label: t("title") }]}
      />
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <ProductForm
        mode="create"
        dictionaries={dictionaries}
        attributesByCategory={attributesByCategory}
        locale={locale}
      />
    </div>
  );
}
