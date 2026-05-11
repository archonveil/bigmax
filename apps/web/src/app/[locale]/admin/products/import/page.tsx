/**
 * `/admin/products/import` — UI для CSV-импорта (P6-T3).
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { ProductImportForm } from "@/components/admin/products/product-import-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
}

export default async function AdminProductImportPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const t = await getTranslations("admin.products.import");

  return (
    <div className="space-y-6" data-testid="admin-product-import">
      <AdminBreadcrumbs
        items={[{ labelKey: "products", href: "/admin/products" }, { label: t("title") }]}
      />
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <ProductImportForm />
    </div>
  );
}
