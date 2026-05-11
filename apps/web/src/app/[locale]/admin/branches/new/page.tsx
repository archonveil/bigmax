import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { BranchForm } from "@/components/admin/taxonomy/branch-form";

export const dynamic = "force-dynamic";

export default async function AdminBranchCreatePage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const t = await getTranslations("admin.branches.form");

  return (
    <div className="space-y-6" data-testid="admin-branch-create">
      <AdminBreadcrumbs
        items={[{ labelKey: "branches", href: "/admin/branches" }, { label: t("createTitle") }]}
      />
      <h2 className="text-2xl font-semibold">{t("createTitle")}</h2>
      <BranchForm mode="create" />
    </div>
  );
}
