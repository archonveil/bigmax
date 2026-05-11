/**
 * FF-002 · per-feature audit timeline.
 *
 * Server component. Рендерится под `<FeatureForm>` на edit-странице.
 * Last 20 записей `feature.updated` + `feature.cache_invalidated` для
 * текущего key'а — кто, когда, old → new (для updated).
 *
 * Pure render — без hooks/state. Audit-log пишется в PATCH/invalidate
 * routes автоматически (P7-T2 sub-task K).
 */

import { Pencil, RotateCcw } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RevertButton } from "@/components/admin/features/revert-button";
import { cn } from "@/lib/utils";
import {
  FEATURE_AUDIT_LIMIT,
  getFeatureAuditLog,
  type FeatureAuditEntry,
} from "@/server/admin-features";

export async function FeatureAuditTimeline({
  featureKey,
  currentValue,
  locale,
}: {
  featureKey: string;
  /** Текущее value feature'ы — нужно для FF-005 RevertButton (diff-preview
   *  + no-op detection). Передаётся со server-side из edit-page. */
  currentValue: string;
  locale: string;
}): Promise<JSX.Element> {
  const entries = await getFeatureAuditLog(featureKey);
  const t = await getTranslations("admin.features.audit");
  const formatter = await getFormatter({ locale });

  return (
    <section className="rounded-lg border bg-card p-5" data-testid="feature-audit-timeline">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        {entries.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("limitHint", { limit: FEATURE_AUDIT_LIMIT })}
          </p>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="feature-audit-list">
          {entries.map((entry) => (
            <AuditRow
              key={entry.id}
              entry={entry}
              featureKey={featureKey}
              currentValue={currentValue}
              dateLabel={formatter.dateTime(entry.createdAt, "long")}
              labelUpdated={t("actions.updated")}
              labelInvalidated={t("actions.invalidated")}
              labelArrow={t("arrow")}
              labelBy={t("by", { email: entry.adminEmail ?? t("unknownAdmin") })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditRow({
  entry,
  featureKey,
  currentValue,
  dateLabel,
  labelUpdated,
  labelInvalidated,
  labelArrow,
  labelBy,
}: {
  entry: FeatureAuditEntry;
  featureKey: string;
  currentValue: string;
  dateLabel: string;
  labelUpdated: string;
  labelInvalidated: string;
  labelArrow: string;
  labelBy: string;
}): JSX.Element {
  const isUpdate = entry.action === "feature.updated";
  const Icon = isUpdate ? Pencil : RotateCcw;
  const iconClass = isUpdate ? "text-primary" : "text-amber-600 dark:text-amber-400";
  // FF-005: revert доступен только для `updated`-row'ов с известным `oldValue`.
  // `cache_invalidated` — нечего возвращать. `oldValue === null` (старый log
  // без полного payload'а) — нечем возвращать.
  const canRevert = isUpdate && entry.oldValue !== null;

  return (
    <li
      className="flex items-start gap-3 rounded-md border bg-background px-3 py-2"
      data-testid="feature-audit-row"
      data-action={entry.action}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{isUpdate ? labelUpdated : labelInvalidated}</p>
        {isUpdate && entry.oldValue !== null && entry.newValue !== null ? (
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            <span className="line-through opacity-70">{entry.oldValue}</span>
            <span className="mx-1.5">{labelArrow}</span>
            <span className="text-foreground">{entry.newValue}</span>
          </p>
        ) : null}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {dateLabel} · {labelBy}
        </p>
      </div>
      {canRevert ? (
        <RevertButton
          featureKey={featureKey}
          targetValue={entry.oldValue ?? ""}
          currentValue={currentValue}
        />
      ) : null}
    </li>
  );
}
