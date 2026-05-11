import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { CategoryForm } from "@/components/admin/taxonomy/category-form";
import { getCategoryParentChoices } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminCategoryCreatePage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const parentChoices = await getCategoryParentChoices(null);
  const t = await getTranslations("admin.categories.form");

  return (
    <div className="space-y-6" data-testid="admin-category-create">
      <AdminBreadcrumbs
        items={[{ labelKey: "categories", href: "/admin/categories" }, { label: t("createTitle") }]}
      />
      <h2 className="text-2xl font-semibold">{t("createTitle")}</h2>
      <CategoryForm mode="create" parentChoices={parentChoices} />
    </div>
  );
}
