"use client";

/**
 * `<ProductImportForm>` (P6-T3) — простая форма с textarea для CSV +
 * file-upload (читаем как text). На submit POST'им как `text/csv`.
 * Результат рендерится inline: created/updated/skipped[].
 */

import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

interface SkippedRow {
  rowIndex: number;
  reason: string;
  detail?: string;
}

interface ImportResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: SkippedRow[];
}

const PLACEHOLDER = `slug,name_ru,name_uz,name_en,category_slug,brand_slug,age_from_months,age_to_months,gender
test-product-1,Тестовый товар 1,Test mahsulot 1,Test product 1,toys,nuby,0,12,unisex
test-product-2,Тестовый товар 2,Test mahsulot 2,Test product 2,food,,6,24,unisex`;

export function ProductImportForm(): JSX.Element {
  const t = useTranslations("admin.products.import");
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
      const res = await fetch("/api/admin/products/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });
      if (res.ok) {
        const body = (await res.json()) as ImportResult;
        setResult(body);
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as {
        reason?: string;
        missing?: string[];
        max?: number;
      };
      const reason = errBody.reason ?? "generic";
      if (reason === "missing_columns") {
        setError(t("errors.missing_columns", { missing: (errBody.missing ?? []).join(", ") }));
      } else if (reason === "too_many_rows") {
        setError(t("errors.too_many_rows", { max: errBody.max ?? 1000 }));
      } else if (reason === "empty_body") {
        setError(t("errors.empty_body"));
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
    <form onSubmit={onSubmit} className="space-y-4" data-testid="product-import-form">
      <div className="space-y-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e)}
          disabled={submitting}
          data-testid="product-import-file"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
        />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={PLACEHOLDER}
          disabled={submitting}
          required
          minLength={20}
          data-testid="product-import-textarea"
          className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
        />
      </div>
      <Button type="submit" disabled={submitting} data-testid="product-import-submit">
        {submitting ? t("submitting") : t("submit")}
      </Button>

      {error ? (
        <p className="text-sm text-destructive" data-testid="product-import-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <section
          className="space-y-3 rounded-md border bg-muted/30 p-3"
          data-testid="product-import-result"
        >
          <p className="text-sm font-medium">
            {t("summary", {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped.length,
            })}
          </p>
          {result.skipped.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                {t("skippedTitle")}
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {result.skipped.map((s, i) => (
                  <li key={i} data-testid="product-import-skipped-row">
                    <span className="font-mono">#{s.rowIndex}</span>{" "}
                    <span className="text-rose-700">{translateSkipReason(s.reason, t)}</span>
                    {s.detail ? <span className="text-muted-foreground"> · {s.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}

function translateSkipReason(
  reason: string,
  t: ReturnType<typeof useTranslations<"admin.products.import">>,
): string {
  const known = [
    "invalid_row",
    "unknown_category",
    "unknown_brand",
    "slug_conflict",
    "db_error",
  ] as const;
  if ((known as readonly string[]).includes(reason)) {
    return t(`skipReasons.${reason as (typeof known)[number]}`);
  }
  return reason;
}
