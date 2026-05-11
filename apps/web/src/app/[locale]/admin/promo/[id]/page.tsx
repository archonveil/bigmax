/**
 * P7-T1 · /admin/promo/[id] — редактирование промокода.
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PromoForm } from "@/components/admin/promo/promo-form";
import { getAdminPromoById } from "@/server/admin-promo";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
}

export default async function AdminPromoEditPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const promo = await getAdminPromoById(params.id);
  if (!promo) notFound();

  const t = await getTranslations("admin.promo.edit");

  return (
    <div className="space-y-6" data-testid="admin-promo-edit" data-id={promo.id}>
      <AdminBreadcrumbs
        items={[{ labelKey: "promo", href: "/admin/promo" }, { label: promo.code }]}
      />
      <AdminPageHeader title={t("title", { code: promo.code })} subtitle={t("subtitle")} />
      <PromoForm mode="edit" promo={promo} />
    </div>
  );
}
