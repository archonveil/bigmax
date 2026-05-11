import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { BrandForm } from "@/components/admin/taxonomy/brand-form";

export const dynamic = "force-dynamic";

export default async function AdminBrandCreatePage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const t = await getTranslations("admin.brands.form");

  return (
    <div className="space-y-6" data-testid="admin-brand-create">
      <AdminBreadcrumbs
        items={[{ labelKey: "brands", href: "/admin/brands" }, { label: t("createTitle") }]}
      />
      <h2 className="text-2xl font-semibold">{t("createTitle")}</h2>
      <BrandForm mode="create" />
    </div>
  );
}
