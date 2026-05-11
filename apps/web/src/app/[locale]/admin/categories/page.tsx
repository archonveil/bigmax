/**
 * `/admin/categories` — list page (P6-T4).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { FolderTree, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CategoryTree } from "@/components/admin/taxonomy/category-tree";
import { Button } from "@/components/ui/button";
import { getAdminCategories } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const items = await getAdminCategories();
  const t = await getTranslations("admin.categories.list");

  return (
    <div className="space-y-6" data-testid="admin-categories">
      <AdminBreadcrumbs items={[{ labelKey: "categories" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/admin/categories/new" data-testid="admin-categories-create">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t("create")}
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <AdminEmptyState icon={FolderTree} title={t("empty")} />
      ) : (
        <CategoryTree items={items} />
      )}
    </div>
  );
}
