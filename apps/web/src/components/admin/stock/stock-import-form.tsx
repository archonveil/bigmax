"use client";

/**
 * `<StockImportForm>` (P6-T7) — CSV-импорт остатков по SKU + branch.
 * Pattern: `<ProductImportForm>` из P6-T3, с `text/csv` body и
 * inline-summary `{processed, skipped[]}`.
 */

import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

interface SkippedRow {
  row: number;
  sku: string;
  reason: string;
}

interface ImportResult {
  ok: boolean;
  processed: number;
  skipped: SkippedRow[];
}

const PLACEHOLDER = `sku,branch_id,quantity
NB-PAC-PK,br-tashkent,25
CH-BD-62-WH,br-samarkand,40
PM-PC-3-60,br-tashkent,12`;

export function StockImportForm(): JSX.Element {
  const t = useTranslations("admin.stock.import");
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || csv.trim() === "") return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/stock/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });
      if (res.ok) {
        const body = (await res.json()) as ImportResult;
        setResult(body);
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string };
      const reason = errBody.reason ?? "generic";
      const known = ["empty", "missing_columns", "too_many_rows"] as const;
      if ((known as readonly string[]).includes(reason)) {
        setError(t(`errors.${reason as (typeof known)[number]}`));
      } else {
        setError(t("errors.generic"));
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="stock-import-form">
      <div className="space-y-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e)}
          disabled={submitting}
          data-testid="stock-import-file"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
        />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={PLACEHOLDER}
          disabled={submitting}
          required
          rows={12}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
          data-testid="stock-import-csv"
        />
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>

      <Button
        type="submit"
        disabled={submitting || csv.trim() === ""}
        data-testid="stock-import-submit"
      >
        {submitting ? t("submitting") : t("submit")}
      </Button>

      {error ? (
        <p className="text-sm text-destructive" data-testid="stock-import-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className="rounded-md border bg-muted/30 p-4 text-sm"
          data-testid="stock-import-result"
        >
          <p className="font-medium">{t("result", { processed: result.processed })}</p>
          {result.skipped.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("skippedSummary", { count: result.skipped.length })}
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {result.skipped.map((s) => (
                  <li key={`${s.row}-${s.sku}`}>
                    <span className="font-mono">{t("skippedRow", { row: s.row, sku: s.sku })}</span>{" "}
                    — <span className="text-destructive">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
