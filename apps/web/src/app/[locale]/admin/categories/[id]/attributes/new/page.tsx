import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { CategoryAttributeForm } from "@/components/admin/taxonomy/category-attribute-form";
import { getAdminCategory } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminCategoryAttributeNewPage({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const [category, t] = await Promise.all([
    getAdminCategory(params.id),
    getTranslations("admin.categoryAttributes"),
  ]);
  if (!category) notFound();

  return (
    <div className="space-y-6" data-testid="admin-category-attribute-new">
      <AdminBreadcrumbs
        items={[
          { labelKey: "categories", href: "/admin/categories" },
          { label: category.nameRu, href: `/admin/categories/${category.id}` },
          {
            label: t("title"),
            href: `/admin/categories/${category.id}/attributes`,
          },
          { label: t("create") },
        ]}
      />
      <h2 className="text-2xl font-semibold">{t("create")}</h2>
      <CategoryAttributeForm mode="create" categoryId={category.id} />
    </div>
  );
}
