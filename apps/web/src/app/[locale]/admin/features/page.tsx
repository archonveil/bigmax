/**
 * P7-T2 sub-task G · /admin/features — список runtime-feature flags.
 *
 * Read-only список с переходом на edit-страницу. Создание/удаление row'ы
 * НЕ через UI — features заводятся миграциями (защищает type-contract).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { Flag } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FeatureInlineToggle } from "@/components/admin/features/feature-inline-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canChangeFeature } from "@/lib/feature-permissions";
import type { AdminRole } from "@/server/admin-auth";
import { getAdminFeatures } from "@/server/admin-features";

export const dynamic = "force-dynamic";

export default async function AdminFeaturesPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  // FF-011: per-flag role gate. Layout уже гарантирует role ∈ {admin, manager}.
  const session = await auth();
  const role = (session?.user.role ?? "manager") as AdminRole;

  const items = await getAdminFeatures();
  const t = await getTranslations("admin.features.list");
  const tType = await getTranslations("admin.features.types");
  const formatter = await getFormatter({ locale: params.locale });

  return (
    <div className="space-y-6" data-testid="admin-features">
      <AdminBreadcrumbs items={[{ labelKey: "features" }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      {items.length === 0 ? (
        <AdminEmptyState icon={Flag} title={t("empty")} />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-features-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.key")}</TableHead>
                <TableHead>{t("table.type")}</TableHead>
                <TableHead>{t("table.value")}</TableHead>
                <TableHead>{t("table.updatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.key} data-testid="admin-features-row" data-key={row.key}>
                  <TableCell>
                    <Link
                      href={`/admin/features/${row.key}` as never}
                      className="font-mono text-sm font-semibold text-primary hover:underline"
                    >
                      {row.key}
                    </Link>
                    {row.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tType(row.type)}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {/* FF-001: для boolean-rows рендерим inline-toggle. Для
                        остальных типов — read-only mono-текст (clickable key
                        выше уже ведёт на edit-страницу).
                        FF-011: для unauthorized role'ей toggle превращается в
                        обычный read-only текст (defense-in-depth — API всё
                        равно отдаст 403, но UI не должен предлагать действие). */}
                    {row.type === "boolean" && canChangeFeature(role, row.key) ? (
                      <FeatureInlineToggle featureKey={row.key} initialValue={row.value} />
                    ) : (
                      row.value
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatter.dateTime(row.updatedAt, "short")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{t("seedHint")}</p>
    </div>
  );
}
