/**
 * `/admin/images-cleanup` — orphan-image cleanup admin page (Phase 7).
 *
 * Server-page render'ит layout + breadcrumbs + Client-component
 * `<ImagesCleanupRunner>` который делает POST '/api/admin/images/cleanup-orphans'
 * (dry-run или real) и показывает отчёт.
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ImagesCleanupRunner } from "@/components/admin/images/images-cleanup-runner";

export const dynamic = "force-dynamic";

export default async function ImagesCleanupPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("admin.imagesCleanup");

  return (
    <div className="space-y-6" data-testid="admin-images-cleanup">
      <AdminBreadcrumbs items={[{ label: t("breadcrumb") }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />
      <ImagesCleanupRunner />
    </div>
  );
}
