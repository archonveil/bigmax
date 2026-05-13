"use client";

/**
 * `<QuickAttributeDialog>` — inline-форма для добавления новой характеристики
 * к выбранной категории прямо из ProductForm. Поддерживает все 5 kind'ов:
 *   - text / boolean        → label + key
 *   - range                 → label + key + min/max/step + unit
 *   - enum / multiselect    → label + key + список option'ов (value + label)
 *
 * Submit → POST `/api/admin/categories/{id}/attributes` → onCreated().
 * Caller обычно делает `router.refresh()` чтобы attribute-config для
 * категории перечитался.
 */

import {
  CheckCircle2,
  CircleDot,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  Sliders,
  Trash2,
  Type as TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  ATTRIBUTE_KINDS,
  type AttributeKind,
  type AttributeOption,
  type CategoryAttributeConfig,
} from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { slugify } from "@/lib/slugify";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<AttributeKind, LucideIcon> = {
  enum: CircleDot,
  multiselect: ListChecks,
  range: Sliders,
  boolean: CheckCircle2,
  text: TypeIcon,
};

interface OptionDraft {
  value: string;
  labelRu: string;
}

interface QuickAttributeDialogProps {
  categoryId: string;
  /** Render-функция для триггера. Если не передана — рендерится дефолтная. */
  trigger?: React.ReactNode;
  /** Вызывается с полностью оптимистичным конфигом нового атрибута —
   *  parent добавляет его в local-state и editor рендерит новое поле сразу,
   *  без RSC re-render'а. */
  onCreated: (config: CategoryAttributeConfig) => void;
}

interface State {
  key: string;
  keyTouched: boolean;
  kind: AttributeKind;
  labelRu: string;
  isFilterable: boolean;
  isRequired: boolean;
  // range-specific
  min: string;
  max: string;
  step: string;
  unitRu: string;
  // options for enum/multiselect
  options: OptionDraft[];
}

const EMPTY: State = {
  key: "",
  keyTouched: false,
  kind: "enum",
  labelRu: "",
  isFilterable: true,
  isRequired: false,
  min: "",
  max: "",
  step: "",
  unitRu: "",
  options: [{ value: "", labelRu: "" }],
};

export function QuickAttributeDialog({
  categoryId,
  trigger,
  onCreated,
}: QuickAttributeDialogProps): JSX.Element {
  const t = useTranslations("admin.products.quickCreate.attribute");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setState(EMPTY);
    setError(null);
  };

  const onLabelRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      labelRu: v,
      key: s.keyTouched ? s.key : slugify(v, { separator: "_", maxLength: 32 }),
    }));
  };

  const onKeyChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setState((s) => ({ ...s, key: cleaned, keyTouched: cleaned.length > 0 }));
  };

  const updateOption = (idx: number, patch: Partial<OptionDraft>): void => {
    setState((s) => {
      const next = [...s.options];
      const cur = next[idx] ?? { value: "", labelRu: "" };
      next[idx] = { ...cur, ...patch };
      return { ...s, options: next };
    });
  };

  const addOption = (): void => {
    setState((s) => ({ ...s, options: [...s.options, { value: "", labelRu: "" }] }));
  };

  const removeOption = (idx: number): void => {
    setState((s) => ({ ...s, options: s.options.filter((_, i) => i !== idx) }));
  };

  const needsOptions = state.kind === "enum" || state.kind === "multiselect";
  const isRange = state.kind === "range";

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (submitting) return;

    // Validate locally first — option-required check and pre-clean.
    let options: Array<{ value: string; labelRu: string }> | undefined;
    if (needsOptions) {
      const cleaned = state.options
        .map((o) => {
          const labelRu = o.labelRu.trim();
          const value =
            o.value.trim() !== ""
              ? o.value
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]/g, "")
              : slugify(labelRu, { separator: "_", maxLength: 64 });
          return { value, labelRu };
        })
        .filter((o) => o.value.length > 0 && o.labelRu.length > 0);
      if (cleaned.length === 0) {
        setError(t("errors.optionsRequired"));
        return;
      }
      options = cleaned;
    }

    const body: Record<string, unknown> = {
      key: state.key,
      kind: state.kind,
      labelRu: state.labelRu.trim(),
      isFilterable: state.isFilterable,
      isRequired: state.isRequired,
      order: 100,
    };
    if (options) body["options"] = options;
    if (isRange) {
      if (state.min.trim() !== "") body["min"] = Number(state.min);
      if (state.max.trim() !== "") body["max"] = Number(state.max);
      if (state.step.trim() !== "") body["step"] = Number(state.step);
      if (state.unitRu.trim() !== "") body["unitRu"] = state.unitRu.trim();
    }
    const labelRu = state.labelRu.trim();

    setSubmitting(true);
    setError(null);
    setOpen(false);
    reset();

    const snapshot = { ...state };
    const request = fetch(`/api/admin/categories/${categoryId}/attributes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        reason?: string;
        message?: string;
      };
      if (res.ok && data.ok && data.id) {
        const config = synthAttributeConfig(data.id, categoryId, snapshot, options);
        onCreated(config);
        return labelRu;
      }
      throw new Error(data.message ?? data.reason ?? "generic");
    });

    // Один toast со стабильным id, который обновляется в три фазы:
    // loading → success/error.
    const toastId = "quick-attribute";
    toast.loading(t("submitting"), { id: toastId });
    request
      .then(
        (label) => toast.success(t("success", { label }), { id: toastId }),
        () => toast.error(t("errors.generic"), { id: toastId }),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="quick-create-attribute-trigger"
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Kind picker */}
          <section className="space-y-1.5">
            <Label>{t("fields.kind")}</Label>
            <div
              role="radiogroup"
              aria-label={t("fields.kind")}
              className="grid grid-cols-2 gap-2 sm:grid-cols-5"
            >
              {ATTRIBUTE_KINDS.map((k) => {
                const Icon = KIND_ICONS[k];
                const selected = state.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setState((s) => ({ ...s, kind: k }))}
                    disabled={submitting}
                    data-testid={`quick-attr-kind-${k}`}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-md border p-2 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-input hover:border-foreground/30 hover:bg-accent/30",
                    )}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-xs font-medium capitalize">{t(`kinds.${k}`)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Label + key */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="qattr-label" required>
                {t("fields.label")}
              </FieldLabel>
              <Input
                id="qattr-label"
                required
                minLength={1}
                maxLength={80}
                value={state.labelRu}
                onChange={(e) => onLabelRuChange(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="qattr-key" required>
                {t("fields.key")}
              </FieldLabel>
              <Input
                id="qattr-key"
                required
                minLength={1}
                maxLength={32}
                pattern="^[a-z][a-z0-9_]{0,31}$"
                value={state.key}
                onChange={(e) => onKeyChange(e.target.value)}
                disabled={submitting}
                className="font-mono text-sm"
              />
            </div>
          </div>

          {/* Range-specific fields */}
          {isRange ? (
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="qattr-min" optional>
                  {t("fields.min")}
                </FieldLabel>
                <Input
                  id="qattr-min"
                  type="number"
                  value={state.min}
                  onChange={(e) => setState((s) => ({ ...s, min: e.target.value }))}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="qattr-max" optional>
                  {t("fields.max")}
                </FieldLabel>
                <Input
                  id="qattr-max"
                  type="number"
                  value={state.max}
                  onChange={(e) => setState((s) => ({ ...s, max: e.target.value }))}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="qattr-step" optional>
                  {t("fields.step")}
                </FieldLabel>
                <Input
                  id="qattr-step"
                  type="number"
                  step="any"
                  value={state.step}
                  onChange={(e) => setState((s) => ({ ...s, step: e.target.value }))}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="qattr-unit" optional>
                  {t("fields.unit")}
                </FieldLabel>
                <Input
                  id="qattr-unit"
                  maxLength={20}
                  value={state.unitRu}
                  onChange={(e) => setState((s) => ({ ...s, unitRu: e.target.value }))}
                  disabled={submitting}
                />
              </div>
            </div>
          ) : null}

          {/* Options editor */}
          {needsOptions ? (
            <section className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label>{t("fields.options")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addOption}
                  disabled={submitting}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" aria-hidden />
                  {t("addOption")}
                </Button>
              </div>
              <div className="space-y-1.5">
                {state.options.map((opt, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5"
                    data-testid={`quick-attr-option-${idx}`}
                  >
                    <Input
                      placeholder={t("optionLabelPlaceholder")}
                      maxLength={80}
                      value={opt.labelRu}
                      onChange={(e) => updateOption(idx, { labelRu: e.target.value })}
                      disabled={submitting}
                      className="flex-1"
                    />
                    <Input
                      placeholder={t("optionValuePlaceholder")}
                      maxLength={64}
                      value={opt.value}
                      onChange={(e) => updateOption(idx, { value: e.target.value })}
                      disabled={submitting}
                      className="w-32 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeOption(idx)}
                      disabled={submitting || state.options.length <= 1}
                      aria-label={t("removeOption")}
                      className="h-9 w-9 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("optionHint")}</p>
            </section>
          ) : null}

          {/* Flags */}
          <div className="grid gap-2 sm:grid-cols-2">
            <FlagToggle
              id="qattr-required"
              label={t("fields.isRequired")}
              checked={state.isRequired}
              onCheckedChange={(v) => setState((s) => ({ ...s, isRequired: v }))}
              disabled={submitting}
            />
            <FlagToggle
              id="qattr-filterable"
              label={t("fields.isFilterable")}
              checked={state.isFilterable}
              onCheckedChange={(v) => setState((s) => ({ ...s, isFilterable: v }))}
              disabled={submitting}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="quick-create-attribute-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="quick-create-attribute-submit">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {t("submitting")}
                </>
              ) : (
                t("submit")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Builds a CategoryAttributeConfig from form state + server-returned id.
 * Используется, чтобы parent мог optimistically отрендерить новый атрибут
 * без `router.refresh()`. UZ/EN labels — пустые (RU-fallback на read-стороне);
 * helpText — null. order=100 совпадает с тем, что отправили POST'ом.
 */
function synthAttributeConfig(
  id: string,
  categoryId: string,
  snapshot: State,
  options: Array<{ value: string; labelRu: string }> | undefined,
): CategoryAttributeConfig {
  const baseLabels = {
    labelRu: snapshot.labelRu.trim(),
    labelUz: "",
    labelEn: "",
    helpTextRu: null,
    helpTextUz: null,
    helpTextEn: null,
  };
  const base = {
    id,
    categoryId,
    key: snapshot.key,
    isRequired: snapshot.isRequired,
    isFilterable: snapshot.isFilterable,
    order: 100,
    ...baseLabels,
  };
  if (snapshot.kind === "enum") {
    const opts: AttributeOption[] = (options ?? []).map((o) => ({
      value: o.value,
      labelRu: o.labelRu,
      labelUz: "",
      labelEn: "",
    }));
    return { ...base, kind: "enum", options: opts };
  }
  if (snapshot.kind === "multiselect") {
    const opts: AttributeOption[] = (options ?? []).map((o) => ({
      value: o.value,
      labelRu: o.labelRu,
      labelUz: "",
      labelEn: "",
    }));
    return { ...base, kind: "multiselect", options: opts };
  }
  if (snapshot.kind === "range") {
    return {
      ...base,
      kind: "range",
      min: snapshot.min.trim() !== "" ? Number(snapshot.min) : null,
      max: snapshot.max.trim() !== "" ? Number(snapshot.max) : null,
      step: snapshot.step.trim() !== "" ? Number(snapshot.step) : null,
      unitRu: snapshot.unitRu.trim() !== "" ? snapshot.unitRu.trim() : null,
      unitUz: null,
      unitEn: null,
    };
  }
  if (snapshot.kind === "boolean") {
    return { ...base, kind: "boolean" };
  }
  return { ...base, kind: "text" };
}

function FlagToggle({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
