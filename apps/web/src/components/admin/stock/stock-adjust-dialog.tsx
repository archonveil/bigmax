"use client";

/**
 * `<StockAdjustDialog>` — advanced модалка корректировки остатков на одной
 * (variant, branch) паре. Возможности:
 *
 *  - **Mode cards** — Set / Inc / Dec в виде кнопок-карточек с иконками.
 *  - **Live preview** — `current → newQty (Δ)` с цветным индикатором
 *    нового статуса (in stock / low / out).
 *  - **Quick presets** — для inc/dec: `+1 / +5 / +10 / +50 / Max stock`.
 *  - **Preset reasons** — выпадающий список («пересчёт», «поступление»,
 *    «брак», «продажа offline», «иное») + free-form append для уточнения.
 *  - Submit → POST → toast → router.refresh.
 */

import { AlertTriangle, CheckCircle2, Equal, Minus, PackageX, Plus } from "lucide-react";
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
  DialogTrigger,
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

type Mode = "set" | "inc" | "dec";

const MODE_META: Record<Mode, { Icon: typeof Equal; activeCls: string }> = {
  set: {
    Icon: Equal,
    activeCls: "border-primary bg-primary/5 ring-1 ring-primary/30 text-foreground",
  },
  inc: {
    Icon: Plus,
    activeCls:
      "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800",
  },
  dec: {
    Icon: Minus,
    activeCls:
      "border-red-300 bg-red-50 ring-1 ring-red-200 text-red-900 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800",
  },
};

const PRESET_REASONS = [
  "inventory_recount",
  "shipment_received",
  "damaged",
  "offline_sale",
  "return",
  "other",
] as const;
type PresetReason = (typeof PRESET_REASONS)[number];

const QUICK_DELTAS = [1, 5, 10, 50] as const;

interface Props {
  stockId: string;
  sku: string;
  productNameRu: string;
  currentQuantity: number;
  /** Кастомный триггер. Если не передан — рендерим дефолтную outline-кнопку
   *  с текстом «Изменить». Любой кастомный node оборачивается в asChild. */
  trigger?: React.ReactNode;
}

interface AdjustResponse {
  ok: boolean;
  reason?: string;
  oldQty?: number;
  newQty?: number;
}

function applyDraft(current: number, mode: Mode, value: number): number {
  if (Number.isNaN(value)) return current;
  switch (mode) {
    case "set":
      return Math.max(0, value);
    case "inc":
      return Math.max(0, current + value);
    case "dec":
      return Math.max(0, current - value);
  }
}

function statusOf(qty: number): "ok" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

export function StockAdjustDialog({
  stockId,
  sku,
  productNameRu,
  currentQuantity,
  trigger,
}: Props): JSX.Element {
  const t = useTranslations("admin.stock.adjust");
  const tStatus = useTranslations("admin.stock.list.status");
  const tErr = useTranslations("admin.stock.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("set");
  const [value, setValue] = useState<string>(String(currentQuantity));
  const [reasonPreset, setReasonPreset] = useState<PresetReason>("inventory_recount");
  const [reasonNote, setReasonNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when dialog opens (so reopening on another row is clean).
  useEffect(() => {
    if (!open) return;
    setMode("set");
    setValue(String(currentQuantity));
    setReasonPreset("inventory_recount");
    setReasonNote("");
    setError(null);
  }, [open, currentQuantity]);

  // Default value semantics per mode:
  //   set → currentQuantity, inc/dec → 1
  useEffect(() => {
    setValue(mode === "set" ? String(currentQuantity) : "1");
  }, [mode, currentQuantity]);

  const numericValue = useMemo(() => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [value]);

  const newQty = applyDraft(currentQuantity, mode, numericValue);
  const delta = newQty - currentQuantity;
  const newStatus = statusOf(newQty);

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
      const res = await fetch(`/api/admin/stock/${stockId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, value: numericValue, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as AdjustResponse;
      if (res.ok && body.ok) {
        toast.success(t("successTitle", { sku }), {
          description: t("successBody", { old: body.oldQty ?? 0, new: body.newQty ?? 0 }),
        });
        setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" data-testid="stock-adjust-trigger">
            {t("trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("title", { sku, product: productNameRu })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" data-testid="stock-adjust-form">
          {/* ---- Live preview card ---- */}
          <div className="rounded-lg border bg-muted/30 p-3" data-testid="stock-adjust-preview">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("previewCurrent")}
                </p>
                <p className="font-mono text-2xl font-semibold tabular-nums">{currentQuantity}</p>
              </div>
              <DeltaBadge delta={delta} mode={mode} />
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("previewNew")}
                </p>
                <p
                  className={cn(
                    "font-mono text-2xl font-bold tabular-nums",
                    newStatus === "out" && "text-red-700 dark:text-red-400",
                    newStatus === "low" && "text-amber-700 dark:text-amber-400",
                    newStatus === "ok" && "text-emerald-700 dark:text-emerald-400",
                  )}
                  data-testid="stock-adjust-preview-new"
                  data-health={newStatus}
                >
                  {newQty}
                </p>
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <NewStatusPill status={newStatus} label={tStatus(newStatus)} />
            </div>
          </div>

          {/* ---- Mode cards ---- */}
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("modeLegend")}</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("modeLegend")}>
              {(["set", "inc", "dec"] as const).map((m) => {
                const meta = MODE_META[m];
                const Icon = meta.Icon;
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m)}
                    disabled={submitting}
                    data-testid={`stock-adjust-mode-${m}`}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? meta.activeCls
                        : "border-input bg-background hover:border-foreground/30 hover:bg-accent/40",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        active ? "bg-foreground/10" : "bg-muted",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-sm font-medium">{t(`mode.${m}`)}</span>
                    <span className="text-[11px] text-muted-foreground">{t(`modeDesc.${m}`)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- Value + quick presets ---- */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-adjust-value">{t(`valueLabel.${mode}`)}</Label>
            <Input
              id="stock-adjust-value"
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
              required
              data-testid="stock-adjust-value"
            />
            {mode !== "set" ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_DELTAS.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => setValue(String(n))}
                    data-testid={`stock-adjust-preset-${mode}-${n}`}
                    className="h-7 px-2 text-xs"
                  >
                    {mode === "inc" ? `+${n}` : `−${n}`}
                  </Button>
                ))}
                {mode === "dec" && currentQuantity > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => setValue(String(currentQuantity))}
                    data-testid="stock-adjust-preset-dec-all"
                    className="h-7 px-2 text-xs"
                  >
                    {t("presetWriteOffAll")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ---- Reason: preset + free-form note ---- */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-adjust-reason-preset">{t("reason")}</Label>
            <Select
              value={reasonPreset}
              onValueChange={(v) => setReasonPreset(v as PresetReason)}
              disabled={submitting}
            >
              <SelectTrigger
                id="stock-adjust-reason-preset"
                data-testid="stock-adjust-reason-preset"
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
              data-testid="stock-adjust-reason-note"
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="stock-adjust-error">
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
              disabled={submitting || delta === 0}
              data-testid="stock-adjust-submit"
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeltaBadge({ delta, mode }: { delta: number; mode: Mode }): JSX.Element {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
        {mode === "set" ? "=" : "Δ 0"}
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-xs font-medium",
        positive
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
      )}
      data-testid="stock-adjust-delta"
    >
      {positive ? (
        <Plus className="h-3 w-3" aria-hidden />
      ) : (
        <Minus className="h-3 w-3" aria-hidden />
      )}
      {Math.abs(delta)}
    </span>
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
  t: ReturnType<typeof useTranslations<"admin.stock.adjust">>,
): string {
  const presetText = t(`reasonPresets.${preset}`);
  const cleanNote = note.trim();
  if (preset === "other") {
    // For "other" the note IS the reason — must be non-empty (server will reject "<3").
    return cleanNote;
  }
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
    "reason_too_short",
    "reason_too_long",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
