/**
 * `/admin/stock/import` — CSV-импорт остатков (P6-T7).
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { StockImportForm } from "@/components/admin/stock/stock-import-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
}

export default async function AdminStockImportPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("admin.stock.import");
  const tList = await getTranslations("admin.stock.list");

  return (
    <div className="space-y-6" data-testid="admin-stock-import">
      <AdminBreadcrumbs
        items={[{ labelKey: "stock", href: "/admin/stock" }, { label: tList("import") }]}
      />
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <StockImportForm />
    </div>
  );
}
