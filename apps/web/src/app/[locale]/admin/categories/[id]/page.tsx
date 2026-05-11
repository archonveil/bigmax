import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { CategoryForm } from "@/components/admin/taxonomy/category-form";
import { Button } from "@/components/ui/button";
import { getAdminCategory, getCategoryParentChoices } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminCategoryEditPage({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const [category, parentChoices, tAttr] = await Promise.all([
    getAdminCategory(params.id),
    getCategoryParentChoices(params.id),
    getTranslations("admin.categoryAttributes"),
  ]);
  if (!category) notFound();

  return (
    <div className="space-y-6" data-testid="admin-category-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "categories", href: "/admin/categories" }, { label: category.nameRu }]}
      />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold">{category.nameRu}</h2>
        <Button asChild variant="outline" size="sm" data-testid="admin-category-attributes-link">
          <Link href={`/admin/categories/${category.id}/attributes` as never}>
            {tAttr("manageCta")}
          </Link>
        </Button>
      </header>
      <CategoryForm mode="edit" category={category} parentChoices={parentChoices} />
    </div>
  );
}
