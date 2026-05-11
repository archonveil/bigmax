import { prisma } from "@bigmax/db";
import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { CategoryAttributeList } from "@/components/admin/taxonomy/category-attribute-list";
import { Button } from "@/components/ui/button";
import { getAdminCategoryAttributes } from "@/server/admin-category-attributes";
import { getAdminCategory } from "@/server/admin-taxonomy";
import { getCategoryAttributes } from "@/server/category-attributes";

export const dynamic = "force-dynamic";

export default async function AdminCategoryAttributesPage({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const [category, ownAttributes, mergedAttributes, t] = await Promise.all([
    getAdminCategory(params.id),
    // OWN — то, что admin может править на ЭТОЙ категории.
    getAdminCategoryAttributes(params.id),
    // MERGED — own + inherited (родительские) для отображения цепочки.
    getCategoryAttributes(params.id),
    getTranslations("admin.categoryAttributes"),
  ]);
  if (!category) notFound();

  // Inherited = merged \ own (по `id`). Подгружаем родительские категории
  // для рендера badge'а с источником наследования.
  const ownIds = new Set(ownAttributes.map((a) => a.id));
  const inheritedConfigs = mergedAttributes.filter((a) => !ownIds.has(a.id));
  const parentCategoryIds = Array.from(new Set(inheritedConfigs.map((a) => a.categoryId)));
  const parentCategories = parentCategoryIds.length
    ? await prisma.category.findMany({
        where: { id: { in: parentCategoryIds } },
        select: { id: true, nameRu: true },
      })
    : [];
  const parentNameById = new Map(parentCategories.map((c) => [c.id, c.nameRu]));

  return (
    <div className="space-y-6" data-testid="admin-category-attributes">
      <AdminBreadcrumbs
        items={[
          { labelKey: "categories", href: "/admin/categories" },
          { label: category.nameRu, href: `/admin/categories/${category.id}` },
          { label: t("title") },
        ]}
      />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", { category: category.nameRu })}
          </p>
        </div>
        <Button asChild data-testid="admin-category-attribute-create">
          <Link href={`/admin/categories/${category.id}/attributes/new` as never}>
            {t("createCta")}
          </Link>
        </Button>
      </header>
      <CategoryAttributeList
        categoryId={category.id}
        initial={ownAttributes}
        inherited={inheritedConfigs.map((c) => ({
          id: c.id,
          parentCategoryId: c.categoryId,
          parentCategoryName: parentNameById.get(c.categoryId) ?? "—",
          key: c.key,
          kind: c.kind,
          labelRu: c.labelRu,
          isRequired: c.isRequired,
          isFilterable: c.isFilterable,
        }))}
      />
    </div>
  );
}
