"use client";

/**
 * `<ImagesCleanupRunner>` — client UI для orphan-cleanup'а (Phase 7).
 *
 * UX:
 *  1. Admin видит form: minAgeHours (input, default 24) + 2 кнопки.
 *  2. **Preview (dry-run)** — POST с dryRun=true, показывает скольк0 будет
 *     удалено + sample list. БЕЗ деструктивных действий.
 *  3. **Run cleanup** — POST с dryRun=false. Confirm-dialog обязателен.
 *
 * После каждого call'а показываем структурированный результат: scanned /
 * referenced / orphans / freed bytes. Errors per-dir тоже отображаются.
 */

import { AlertTriangle, Loader2, Play, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface CleanupSummary {
  ok: true;
  dryRun: boolean;
  minAgeHours: number;
  scanned: number;
  referenced: number;
  orphanCandidates: number;
  toDeleteCount: number;
  toDelete: Array<{ shard: string; hash: string; ageHours: number; bytes: number }>;
  deleted: number;
  bytesFreed: number;
  errors: Array<{ dir: string; error: string }>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImagesCleanupRunner(): JSX.Element {
  const t = useTranslations("admin.imagesCleanup");
  const [minAgeHours, setMinAgeHours] = useState<string>("24");
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<CleanupSummary | null>(null);

  async function callApi(dryRun: boolean): Promise<void> {
    setRunning(true);
    setSummary(null);
    try {
      const parsedAge = Number.parseInt(minAgeHours, 10);
      const body: { dryRun: boolean; minAgeHours?: number } = { dryRun };
      if (Number.isFinite(parsedAge) && parsedAge >= 1) body.minAgeHours = parsedAge;
      const res = await fetch("/api/admin/images/cleanup-orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as CleanupSummary | { ok: false; reason: string };
      if (res.ok && json.ok) {
        setSummary(json);
        if (!dryRun) {
          toast.success(
            t("toastSuccess", { count: json.deleted, freed: formatBytes(json.bytesFreed) }),
          );
        }
      } else {
        toast.error(t(`error.${("reason" in json && json.reason) || "generic"}` as never));
      }
    } catch {
      toast.error(t("error.network"));
    } finally {
      setRunning(false);
    }
  }

  function onRunReal(): void {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm(t("runConfirm"));
    if (!confirmed) return;
    void callApi(false);
  }

  return (
    <div className="space-y-6">
      {/* Описание + form */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("intro.title")}</p>
            <p className="text-sm text-muted-foreground">{t("intro.body")}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="minAge">{t("fields.minAgeHours")}</Label>
            <Input
              id="minAge"
              type="number"
              min={1}
              max={24 * 30}
              value={minAgeHours}
              onChange={(e) => setMinAgeHours(e.target.value)}
              disabled={running}
              className="w-32"
              data-testid="cleanup-min-age"
            />
            <p className="text-xs text-muted-foreground">{t("fields.minAgeHint")}</p>
          </div>

          <div className="flex items-end gap-2 sm:col-span-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void callApi(true)}
              disabled={running}
              data-testid="cleanup-preview-button"
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="mr-2 h-4 w-4" aria-hidden />
              )}
              {t("buttons.preview")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onRunReal}
              disabled={running}
              data-testid="cleanup-run-button"
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              )}
              {t("buttons.run")}
            </Button>
          </div>
        </div>
      </section>

      {/* Результат */}
      {summary ? (
        <section
          className={cn(
            "space-y-4 rounded-lg border p-4",
            summary.dryRun
              ? "border-primary/30 bg-primary/5"
              : "border-emerald-300 bg-emerald-50/40",
          )}
          data-testid="cleanup-result"
          data-dry-run={summary.dryRun ? "true" : "false"}
        >
          <header className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {summary.dryRun ? t("result.previewTitle") : t("result.realTitle")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {t("result.minAgeBadge", { hours: summary.minAgeHours })}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label={t("result.stat.scanned")} value={summary.scanned} />
            <Stat label={t("result.stat.referenced")} value={summary.referenced} />
            <Stat label={t("result.stat.orphans")} value={summary.orphanCandidates} />
            <Stat
              label={summary.dryRun ? t("result.stat.toDelete") : t("result.stat.deleted")}
              value={summary.dryRun ? summary.toDeleteCount : summary.deleted}
              accent
            />
          </div>

          {!summary.dryRun ? (
            <p className="text-sm">
              {t("result.bytesFreed", { freed: formatBytes(summary.bytesFreed) })}
            </p>
          ) : null}

          {summary.toDelete.length > 0 ? (
            <details className="rounded-md border bg-background p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {summary.dryRun
                  ? t("result.sampleTitleDry", { n: summary.toDelete.length })
                  : t("result.sampleTitleReal", { n: summary.toDelete.length })}
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {summary.toDelete.map((o) => (
                  <li key={o.hash} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {o.shard}/{o.hash}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatBytes(o.bytes)} · {o.ageHours}h
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {summary.errors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {t("result.errorsTitle", { n: summary.errors.length })}
              </p>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {summary.errors.map((e, i) => (
                  <li key={`${e.dir}-${i}`} className="truncate">
                    {e.dir}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", accent && "text-primary")}>
        {value}
      </p>
    </div>
  );
}
