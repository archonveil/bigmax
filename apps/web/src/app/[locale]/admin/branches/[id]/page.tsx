import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { BranchForm } from "@/components/admin/taxonomy/branch-form";
import { getAdminBranch } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminBranchEditPage({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const branch = await getAdminBranch(params.id);
  if (!branch) notFound();
  const t = await getTranslations("admin.branches.form");

  return (
    <div className="space-y-6" data-testid="admin-branch-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "branches", href: "/admin/branches" }, { label: branch.nameRu }]}
      />
      <h2 className="text-2xl font-semibold">{branch.nameRu}</h2>
      <BranchForm mode="edit" branch={branch} />
      {void t}
    </div>
  );
}
