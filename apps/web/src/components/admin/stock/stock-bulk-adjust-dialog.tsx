"use client";

/**
 * `<StockBulkAdjustDialog>` (P6-T7 follow-up — closes (b)).
 *
 * Модалка для bulk-adjust по SKU-pattern в текущем branch'е. Pattern
 * поддерживает `*` wildcard (пример: `NB-*` матчит `NB-PAC-PK`,
 * `NB-PAC-WH`, и т.д.). Submit → POST → toast с counter'ами →
 * router.refresh().
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  branchId: string;
  branchName: string;
}

interface BulkResponse {
  ok: boolean;
  reason?: string;
  processed: number;
  matched: number;
  skipped: Array<{ stockId: string; sku: string; reason: string }>;
}

export function StockBulkAdjustDialog({ branchId, branchName }: Props): JSX.Element {
  const t = useTranslations("admin.stock.bulkAdjust");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [skuPattern, setSkuPattern] = useState("");
  const [mode, setMode] = useState<"set" | "inc" | "dec">("inc");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useConfirm();
  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    const num = Number.parseInt(value, 10);
    if (!Number.isInteger(num) || num < 0) {
      setError(t("invalidValue"));
      return;
    }
    if (skuPattern.trim() === "") {
      setError(t("patternRequired"));
      return;
    }
    if (
      !(await confirm({
        description: t("confirm", { pattern: skuPattern.trim(), branch: branchName }),
      }))
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/stock/bulk-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          skuPattern: skuPattern.trim(),
          mode,
          value: num,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        toast.error(t("error"));
        return;
      }
      const body = (await res.json()) as BulkResponse;
      if (body.matched === 0) {
        toast.error(t("noMatch", { pattern: skuPattern.trim() }));
      } else if (body.skipped.length === 0) {
        toast.success(t("successAll", { count: body.processed }));
      } else {
        toast.success(
          t("successPartial", { processed: body.processed, skipped: body.skipped.length }),
        );
      }
      setOpen(false);
      setSkuPattern("");
      setValue("");
      setReason("");
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="stock-bulk-adjust-trigger">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { branch: branchName })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" data-testid="stock-bulk-adjust-form">
          <div>
            <Label htmlFor="bulk-pattern">{t("patternLabel")}</Label>
            <Input
              id="bulk-pattern"
              value={skuPattern}
              onChange={(e) => setSkuPattern(e.target.value)}
              disabled={submitting}
              required
              maxLength={100}
              placeholder={t("patternPlaceholder")}
              data-testid="stock-bulk-adjust-pattern"
            />
            <p className="text-xs text-muted-foreground">{t("patternHint")}</p>
          </div>
          <fieldset className="flex gap-3">
            <legend className="sr-only">{t("modeLegend")}</legend>
            {(["set", "inc", "dec"] as const).map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-1 text-sm"
                data-testid={`stock-bulk-adjust-mode-${m}`}
              >
                <input
                  type="radio"
                  name="bulk-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  disabled={submitting}
                />
                {t(`mode.${m}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <Label htmlFor="bulk-value">{t(`valueLabel.${mode}`)}</Label>
            <Input
              id="bulk-value"
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
              required
              data-testid="stock-bulk-adjust-value"
            />
          </div>
          <div>
            <Label htmlFor="bulk-reason">{t("reason")}</Label>
            <Input
              id="bulk-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              required
              minLength={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              data-testid="stock-bulk-adjust-reason"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="stock-bulk-adjust-error">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting}
              data-testid="stock-bulk-adjust-submit"
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
