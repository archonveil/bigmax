import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { BrandForm } from "@/components/admin/taxonomy/brand-form";
import { getAdminBrand } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminBrandEditPage({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const brand = await getAdminBrand(params.id);
  if (!brand) notFound();
  const t = await getTranslations("admin.brands.form");

  return (
    <div className="space-y-6" data-testid="admin-brand-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "brands", href: "/admin/brands" }, { label: brand.name }]}
      />
      <h2 className="text-2xl font-semibold">{brand.name}</h2>
      <BrandForm mode="edit" brand={brand} />
      {void t}
    </div>
  );
}
