import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { CategoryAttributeForm } from "@/components/admin/taxonomy/category-attribute-form";
import { getAdminCategoryAttribute } from "@/server/admin-category-attributes";
import { getAdminCategory } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminCategoryAttributeEditPage({
  params,
}: {
  params: { locale: string; id: string; attrId: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const [category, attribute, t] = await Promise.all([
    getAdminCategory(params.id),
    getAdminCategoryAttribute(params.attrId),
    getTranslations("admin.categoryAttributes"),
  ]);
  if (!category || !attribute || attribute.categoryId !== category.id) notFound();

  return (
    <div className="space-y-6" data-testid="admin-category-attribute-edit">
      <AdminBreadcrumbs
        items={[
          { labelKey: "categories", href: "/admin/categories" },
          { label: category.nameRu, href: `/admin/categories/${category.id}` },
          {
            label: t("title"),
            href: `/admin/categories/${category.id}/attributes`,
          },
          { label: attribute.labelRu },
        ]}
      />
      <h2 className="text-2xl font-semibold">{attribute.labelRu}</h2>
      <CategoryAttributeForm mode="edit" categoryId={category.id} attribute={attribute} />
    </div>
  );
}
