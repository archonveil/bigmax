/**
 * P7-T2 sub-task G · /admin/features/[key] — edit value of a single feature.
 * Page rendering всегда server-side (no client-side fetch for value).
 */

import { isLocale } from "@bigmax/shared-types";
import { Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FeatureAuditTimeline } from "@/components/admin/features/feature-audit-timeline";
import { FeatureForm } from "@/components/admin/features/feature-form";
import { InvalidateCacheButton } from "@/components/admin/features/invalidate-cache-button";
import { canChangeFeature } from "@/lib/feature-permissions";
import type { AdminRole } from "@/server/admin-auth";
import { getAdminFeatureByKey } from "@/server/admin-features";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; key: string };
}

export default async function AdminFeatureEditPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const row = await getAdminFeatureByKey(params.key);
  if (!row) notFound();

  const session = await auth();
  const role = (session?.user.role ?? "manager") as AdminRole;
  const canChange = canChangeFeature(role, row.key);

  const t = await getTranslations("admin.features.edit");
  const tGate = await getTranslations("admin.features.gate");
  const tType = await getTranslations("admin.features.types");
  const formatter = await getFormatter({ locale: params.locale });

  return (
    <div
      className="space-y-6"
      data-testid="admin-feature-edit"
      data-key={row.key}
      data-can-change={canChange ? "true" : "false"}
    >
      <AdminBreadcrumbs
        items={[{ labelKey: "features", href: "/admin/features" }, { label: row.key }]}
      />
      <AdminPageHeader
        title={t("title", { key: row.key })}
        subtitle={t("subtitle", {
          type: tType(row.type),
          updatedAt: formatter.dateTime(row.updatedAt, "short"),
        })}
        actions={canChange ? <InvalidateCacheButton featureKey={row.key} /> : null}
      />

      {/* FF-011: per-flag role gate. Если текущая роль не имеет прав
          менять этот feature — рендерим read-only-баннер вместо формы. */}
      {canChange ? (
        <FeatureForm
          featureKey={row.key}
          type={row.type}
          currentValue={row.value}
          description={row.description}
        />
      ) : (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40"
          data-testid="admin-feature-gate-banner"
        >
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden
          />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">{tGate("title")}</p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              {tGate("body", { role })}
            </p>
            {row.description ? (
              <p className="mt-2 text-xs text-muted-foreground">{row.description}</p>
            ) : null}
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {tGate("currentValueLabel")}: <span className="text-foreground">{row.value}</span>
            </p>
          </div>
        </div>
      )}

      {/* FF-002: per-feature audit timeline. Server-rendered; читает последние
          N записей `feature.updated` + `feature.cache_invalidated` для этого
          key из PaymentLog.
          FF-005: каждая `feature.updated`-row получает RevertButton — клик
          ставит value обратно в `oldValue` той row'ы (PATCH через тот же
          API). `currentValue` нужен для diff-preview + no-op detection. */}
      <FeatureAuditTimeline featureKey={row.key} currentValue={row.value} locale={params.locale} />
    </div>
  );
}
