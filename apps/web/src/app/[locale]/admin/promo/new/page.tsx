/**
 * P7-T1 · /admin/promo/new — создание нового промокода.
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PromoForm } from "@/components/admin/promo/promo-form";

export const dynamic = "force-dynamic";

export default async function AdminPromoNewPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("admin.promo.new");

  return (
    <div className="space-y-6" data-testid="admin-promo-new">
      <AdminBreadcrumbs
        items={[{ labelKey: "promo", href: "/admin/promo" }, { label: t("breadcrumb") }]}
      />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />
      <PromoForm mode="create" />
    </div>
  );
}
