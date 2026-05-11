"use client";

/**
 * `<StockCreateDialog>` — модалка создания первой записи остатка для пары
 * (variant, branch). Открывается из `<ProductStockMatrix>` когда ячейка
 * пустая (Stock-row ещё не существует). Бьёт в `POST /api/admin/stock`.
 *
 * Отличия от `<StockAdjustDialog>`:
 *  - Только один режим — set: задаём начальное `quantity`.
 *  - Live preview без «delta» (старого значения нет — это создание).
 *  - Reason-presets ориентированы на инициализацию: «начальный остаток»,
 *    «поступление», «перемещение со склада», …
 */

import { AlertTriangle, CheckCircle2, PackageX, PlusCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LOW_STOCK_THRESHOLD } from "@/server/admin-stock";

const PRESET_REASONS = [
  "initial_stock",
  "shipment_received",
  "inventory_recount",
  "transfer_in",
  "other",
] as const;
type PresetReason = (typeof PRESET_REASONS)[number];

const QUICK_QUANTITIES = [0, 5, 10, 25, 50, 100] as const;

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  variantId: string;
  branchId: string;
  sku: string;
  branchNameRu: string;
}

interface CreateResponse {
  ok: boolean;
  reason?: string;
  message?: string;
  id?: string;
  quantity?: number;
  created?: boolean;
}

function statusOf(qty: number): "ok" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

export function StockCreateDialog({
  open,
  onOpenChange,
  variantId,
  branchId,
  sku,
  branchNameRu,
}: Props): JSX.Element {
  const t = useTranslations("admin.stock.create");
  const tStatus = useTranslations("admin.stock.list.status");
  const tErr = useTranslations("admin.stock.errors");
  const tCreateErr = useTranslations("admin.stock.create.errors");
  const router = useRouter();

  const [value, setValue] = useState("0");
  const [reasonPreset, setReasonPreset] = useState<PresetReason>("initial_stock");
  const [reasonNote, setReasonNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when dialog opens (so reopening on another cell is clean).
  useEffect(() => {
    if (!open) return;
    setValue("0");
    setReasonPreset("initial_stock");
    setReasonNote("");
    setError(null);
  }, [open]);

  const numericValue = useMemo(() => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [value]);
  const newStatus = statusOf(numericValue);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!Number.isInteger(numericValue) || numericValue < 0) {
      setError(tErr("invalid_value"));
      return;
    }
    const reason = composeReason(reasonPreset, reasonNote, t);
    if (reason.length < 3) {
      setError(tErr("reason_too_short"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, branchId, quantity: numericValue, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as CreateResponse;
      if (res.ok && body.ok) {
        if (body.created === false) {
          // Record already existed — surface that, but still refresh.
          toast.message(tCreateErr("alreadyExists"));
        } else {
          toast.success(t("successTitle", { sku }), {
            description: t("successBody", {
              branch: branchNameRu,
              qty: body.quantity ?? numericValue,
            }),
          });
        }
        onOpenChange(false);
        router.refresh();
        return;
      }
      const key = body.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" aria-hidden />
            {t("title")}
          </DialogTitle>
          <p className="font-mono text-xs text-muted-foreground">
            {t("subtitle", { sku, branch: branchNameRu })}
          </p>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" data-testid="stock-create-form">
          {/* Hint banner */}
          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>{t("missingHint")}</p>
          </div>

          {/* Live preview */}
          <div className="rounded-lg border bg-muted/30 p-3" data-testid="stock-create-preview">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("previewLabel")}
              </p>
              <NewStatusPill status={newStatus} label={tStatus(newStatus)} />
            </div>
            <p
              className={cn(
                "mt-2 font-mono text-3xl font-bold tabular-nums",
                newStatus === "out" && "text-red-700 dark:text-red-400",
                newStatus === "low" && "text-amber-700 dark:text-amber-400",
                newStatus === "ok" && "text-emerald-700 dark:text-emerald-400",
              )}
              data-testid="stock-create-preview-qty"
              data-health={newStatus}
            >
              {numericValue}
            </p>
          </div>

          {/* Quantity input */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-create-value">{t("quantityLabel")}</Label>
            <Input
              id="stock-create-value"
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
              required
              data-testid="stock-create-value"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">{t("quantityHint")}</p>

            <div className="pt-1">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("presetsLabel")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_QUANTITIES.map((n) => {
                  const active = numericValue === n;
                  return (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => setValue(String(n))}
                      data-testid={`stock-create-preset-${n}`}
                      className={cn(
                        "h-7 px-2 font-mono text-xs",
                        active && "border-primary bg-primary/5 text-foreground",
                      )}
                    >
                      {n}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Reason: preset + note */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-create-reason-preset">{t("reason")}</Label>
            <Select
              value={reasonPreset}
              onValueChange={(v) => setReasonPreset(v as PresetReason)}
              disabled={submitting}
            >
              <SelectTrigger
                id="stock-create-reason-preset"
                data-testid="stock-create-reason-preset"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`reasonPresets.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              disabled={submitting}
              maxLength={400}
              placeholder={
                reasonPreset === "other"
                  ? t("reasonNotePlaceholderRequired")
                  : t("reasonNotePlaceholder")
              }
              className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
              data-testid="stock-create-reason-note"
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="stock-create-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="stock-create-submit">
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewStatusPill({
  status,
  label,
}: {
  status: "ok" | "low" | "out";
  label: string;
}): JSX.Element {
  const cfg =
    status === "out"
      ? {
          Icon: PackageX,
          cls: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
        }
      : status === "low"
        ? {
            Icon: AlertTriangle,
            cls: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
          }
        : {
            Icon: CheckCircle2,
            cls: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
          };
  const { Icon, cls } = cfg;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        cls,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

function composeReason(
  preset: PresetReason,
  note: string,
  t: ReturnType<typeof useTranslations<"admin.stock.create">>,
): string {
  const presetText = t(`reasonPresets.${preset}`);
  const cleanNote = note.trim();
  if (preset === "other") return cleanNote;
  return cleanNote === "" ? presetText : `${presetText} — ${cleanNote}`;
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.stock.errors">>,
): string {
  const known = [
    "invalid_body",
    "invalid_value",
    "not_found",
    "invalid_relation",
    "reason_too_short",
    "reason_too_long",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
