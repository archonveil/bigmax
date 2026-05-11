"use client";

/**
 * `<CategoryAttributeForm>` — create/edit конфиг attribute-поля для категории.
 *
 * Discriminated по `kind` (enum/range/boolean/text/multiselect):
 *  - enum/multiselect → редактор options (динамический список с per-locale labels);
 *  - range            → min/max/step/unit per locale;
 *  - boolean/text     → только base поля.
 *
 * Multi-locale label / helpText в `<Tabs>` ru/uz/en. Submit:
 *  - create: POST `/api/admin/categories/[id]/attributes`
 *  - edit:   PATCH `/api/admin/categories/[id]/attributes/[attrId]`
 */

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Sliders,
  Trash2,
  Type as TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ATTRIBUTE_KINDS, type AttributeKind } from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyFromRuButton, LocaleFallbackHint } from "@/components/ui/locale-fallback";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { slugify } from "@/lib/slugify";
import type { AdminCategoryAttributeRow } from "@/server/admin-category-attributes";

type Mode = "create" | "edit";

interface OptionState {
  value: string;
  labelRu: string;
  labelUz: string;
  labelEn: string;
  /** Optional hex color (`#rgb` or `#rrggbb`). Когда задан, UI рендерит
   *  swatch для опции в catalog-filter и в attribute-table. */
  color?: string;
}

interface FormState {
  key: string;
  kind: AttributeKind;
  labelRu: string;
  labelUz: string;
  labelEn: string;
  helpTextRu: string;
  helpTextUz: string;
  helpTextEn: string;
  isRequired: boolean;
  isFilterable: boolean;
  order: string;
  options: OptionState[];
  min: string;
  max: string;
  step: string;
  unitRu: string;
  unitUz: string;
  unitEn: string;
}

function init(a?: AdminCategoryAttributeRow): FormState {
  return {
    key: a?.key ?? "",
    kind: a?.kind ?? "enum",
    labelRu: a?.labelRu ?? "",
    labelUz: a?.labelUz ?? "",
    labelEn: a?.labelEn ?? "",
    helpTextRu: a?.helpTextRu ?? "",
    helpTextUz: a?.helpTextUz ?? "",
    helpTextEn: a?.helpTextEn ?? "",
    isRequired: a?.isRequired ?? false,
    isFilterable: a?.isFilterable ?? true,
    order: String(a?.order ?? 0),
    options:
      a?.options?.map((o) => ({
        value: o.value,
        labelRu: o.labelRu,
        labelUz: o.labelUz,
        labelEn: o.labelEn,
        ...(o.color ? { color: o.color } : {}),
      })) ?? [],
    min: a?.min !== null && a?.min !== undefined ? String(a.min) : "",
    max: a?.max !== null && a?.max !== undefined ? String(a.max) : "",
    step: a?.step !== null && a?.step !== undefined ? String(a.step) : "",
    unitRu: a?.unitRu ?? "",
    unitUz: a?.unitUz ?? "",
    unitEn: a?.unitEn ?? "",
  };
}

interface Props {
  mode: Mode;
  categoryId: string;
  attribute?: AdminCategoryAttributeRow;
}

export function CategoryAttributeForm({ mode, categoryId, attribute }: Props): JSX.Element {
  const t = useTranslations("admin.categoryAttributes");
  const tForm = useTranslations("admin.categoryAttributes.form");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => init(attribute));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-slug logic: pока user не правил `key` руками, при изменении
  // `labelRu` ключ синхронно подставляется через `slugify`. Если key
  // уже задан (edit-mode) или пользователь начал печатать — disabled.
  const [keyTouched, setKeyTouched] = useState(() => Boolean(attribute?.key));

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const onLabelRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      labelRu: v,
      key: keyTouched ? s.key : slugify(v, { separator: "_", maxLength: 32 }),
    }));
  };

  const onKeyChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setKeyTouched(cleaned.length > 0);
    setState((s) => ({ ...s, key: cleaned }));
  };

  const replaceOption = (idx: number, next: OptionState): void => {
    setState((s) => {
      const list = [...s.options];
      if (idx < 0 || idx >= list.length) return s;
      list[idx] = next;
      return { ...s, options: list };
    });
  };

  const addOption = (next: OptionState): void => {
    setState((s) => ({ ...s, options: [...s.options, next] }));
  };

  const removeOption = (idx: number): void => {
    setState((s) => ({ ...s, options: s.options.filter((_, i) => i !== idx) }));
  };

  const moveOption = (idx: number, direction: -1 | 1): void => {
    setState((s) => {
      const next = [...s.options];
      const target = idx + direction;
      if (target < 0 || target >= next.length) return s;
      const a = next[idx];
      const b = next[target];
      if (!a || !b) return s;
      next[idx] = b;
      next[target] = a;
      return { ...s, options: next };
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const needOptions = state.kind === "enum" || state.kind === "multiselect";
    const needRange = state.kind === "range";
    const body: Record<string, unknown> = {
      labelRu: state.labelRu,
      labelUz: state.labelUz,
      labelEn: state.labelEn,
      helpTextRu: state.helpTextRu === "" ? null : state.helpTextRu,
      helpTextUz: state.helpTextUz === "" ? null : state.helpTextUz,
      helpTextEn: state.helpTextEn === "" ? null : state.helpTextEn,
      isRequired: state.isRequired,
      isFilterable: state.isFilterable,
      order: Number.parseInt(state.order, 10) || 0,
      options: needOptions ? state.options : null,
      min: needRange && state.min !== "" ? Number.parseFloat(state.min) : null,
      max: needRange && state.max !== "" ? Number.parseFloat(state.max) : null,
      step: needRange && state.step !== "" ? Number.parseFloat(state.step) : null,
      unitRu: needRange && state.unitRu !== "" ? state.unitRu : null,
      unitUz: needRange && state.unitUz !== "" ? state.unitUz : null,
      unitEn: needRange && state.unitEn !== "" ? state.unitEn : null,
    };
    if (mode === "create") {
      body["key"] = state.key;
      body["kind"] = state.kind;
    }

    const url =
      mode === "create"
        ? `/api/admin/categories/${categoryId}/attributes`
        : `/api/admin/categories/${categoryId}/attributes/${attribute!.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(mode === "create" ? t("created") : t("updated"));
        router.push(`/admin/categories/${categoryId}/attributes`);
        router.refresh();
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      const key = errBody.message ?? errBody.reason ?? "generic";
      setError(translateError(key, tForm));
    } catch {
      setError(tForm("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="admin-category-attribute-form">
      {/* Kind — visual card picker (full-width). */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <Label>{tForm("fields.kind")}</Label>
          {mode === "edit" ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden />
              {tForm("fields.kindLocked")}
            </span>
          ) : null}
        </div>
        <KindPicker
          value={state.kind}
          onChange={(v) => update("kind", v)}
          disabled={mode === "edit" || submitting}
        />
      </section>

      {/* Key — own row. */}
      <section className="space-y-1.5">
        <Label htmlFor="key">{tForm("fields.key")}</Label>
        <Input
          id="key"
          data-testid="admin-attr-key"
          required
          minLength={1}
          maxLength={32}
          pattern="^[a-z][a-z0-9_]{0,31}$"
          value={state.key}
          onChange={(e) => onKeyChange(e.target.value)}
          disabled={mode === "edit" || submitting}
          className="max-w-md font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">{tForm("fields.keyHint")}</p>
      </section>

      {/* Multi-locale labels in tabs */}
      <Tabs defaultValue="ru" className="space-y-3">
        <TabsList>
          <TabsTrigger value="ru">RU</TabsTrigger>
          <TabsTrigger value="uz">UZ</TabsTrigger>
          <TabsTrigger value="en">EN</TabsTrigger>
        </TabsList>
        {(["ru", "uz", "en"] as const).map((loc) => {
          const labelKey = `label${cap(loc)}` as "labelRu" | "labelUz" | "labelEn";
          const helpKey = `helpText${cap(loc)}` as "helpTextRu" | "helpTextUz" | "helpTextEn";
          const isRu = loc === "ru";
          return (
            <TabsContent key={loc} value={loc} className="space-y-3">
              {!isRu ? (
                <>
                  <div className="flex justify-end">
                    <CopyFromRuButton
                      onCopy={() =>
                        setState((s) => ({
                          ...s,
                          [labelKey]: s.labelRu,
                          [helpKey]: s.helpTextRu,
                        }))
                      }
                      disabled={submitting}
                      testId={`admin-attr-copy-from-ru-${loc}`}
                    />
                  </div>
                  <LocaleFallbackHint />
                </>
              ) : null}
              <div className="space-y-1.5">
                {isRu ? (
                  <FieldLabel htmlFor={`label-${loc}`} required>
                    {tForm(`fields.label.${loc}`)}
                  </FieldLabel>
                ) : (
                  <FieldLabel htmlFor={`label-${loc}`} optional>
                    {tForm(`fields.label.${loc}`)}
                  </FieldLabel>
                )}
                <Input
                  id={`label-${loc}`}
                  data-testid={`admin-attr-label-${loc}`}
                  {...(isRu ? { required: true } : {})}
                  maxLength={80}
                  value={state[labelKey]}
                  onChange={(e) =>
                    labelKey === "labelRu"
                      ? onLabelRuChange(e.target.value)
                      : update(labelKey, e.target.value)
                  }
                  disabled={submitting}
                  {...(!isRu ? { placeholder: state.labelRu } : {})}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor={`help-${loc}`} optional>
                  {tForm(`fields.helpText.${loc}`)}
                </FieldLabel>
                <Input
                  id={`help-${loc}`}
                  data-testid={`admin-attr-help-${loc}`}
                  maxLength={400}
                  value={state[helpKey]}
                  onChange={(e) => update(helpKey, e.target.value)}
                  disabled={submitting}
                  {...(!isRu ? { placeholder: state.helpTextRu } : {})}
                />
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Kind-specific section */}
      {state.kind === "enum" || state.kind === "multiselect" ? (
        <OptionsEditor
          options={state.options}
          onAdd={addOption}
          onReplace={replaceOption}
          onRemove={removeOption}
          onMove={moveOption}
          disabled={submitting}
        />
      ) : null}

      {state.kind === "range" ? (
        <RangeEditor state={state} update={update} disabled={submitting} />
      ) : null}

      {/* Flags + order */}
      <section className="grid gap-3 sm:grid-cols-3">
        <FlagToggle
          id="admin-attr-required"
          label={tForm("fields.isRequired")}
          checked={state.isRequired}
          onCheckedChange={(v) => update("isRequired", v)}
          disabled={submitting}
        />
        <FlagToggle
          id="admin-attr-filterable"
          label={tForm("fields.isFilterable")}
          checked={state.isFilterable}
          onCheckedChange={(v) => update("isFilterable", v)}
          disabled={submitting}
        />
        <div className="space-y-1.5">
          <Label htmlFor="order">{tForm("fields.order")}</Label>
          <Input
            id="order"
            data-testid="admin-attr-order"
            type="number"
            min={0}
            max={1000}
            value={state.order}
            onChange={(e) => update("order", e.target.value)}
            disabled={submitting}
          />
        </div>
      </section>

      {error ? (
        <p className="text-sm text-destructive" data-testid="admin-attr-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="admin-attr-submit">
          {submitting
            ? tForm("submitting")
            : mode === "create"
              ? tForm("submitCreate")
              : tForm("submit")}
        </Button>
      </footer>
    </form>
  );
}

function cap<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}

interface FlagToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled: boolean;
}

/** Switch + label в одной горизонтальной плашке. Удобнее checkbox'а
 *  для bool-флагов (явный on/off, фокусируем как чек, но визуально toggle). */
function FlagToggle({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
}: FlagToggleProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        data-testid={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KindPicker — visual radio-card grid для выбора kind атрибута.
// ---------------------------------------------------------------------------

interface KindPickerProps {
  value: AttributeKind;
  onChange: (next: AttributeKind) => void;
  disabled: boolean;
}

const KIND_ICONS: Record<AttributeKind, LucideIcon> = {
  enum: CircleDot,
  multiselect: ListChecks,
  range: Sliders,
  boolean: CheckCircle2,
  text: TypeIcon,
};

function KindPicker({ value, onChange, disabled }: KindPickerProps): JSX.Element {
  const t = useTranslations("admin.categoryAttributes");
  const tForm = useTranslations("admin.categoryAttributes.form");
  return (
    <div
      role="radiogroup"
      aria-label={tForm("fields.kind")}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="admin-attr-kind-picker"
    >
      {ATTRIBUTE_KINDS.map((k) => {
        const Icon = KIND_ICONS[k];
        const selected = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => !disabled && onChange(k)}
            disabled={disabled}
            data-testid={`admin-attr-kind-${k}`}
            data-selected={selected}
            className={[
              "group flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                : "hover:border-foreground/30 hover:bg-accent/40",
            ].join(" ")}
          >
            <div className="flex w-full items-center justify-between">
              <span
                className={[
                  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:bg-muted/80",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              {selected ? (
                <span
                  aria-hidden
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : null}
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold leading-tight">{t(`kinds.${k}`)}</p>
              <p className="text-xs leading-snug text-muted-foreground">
                {tForm(`fields.kindDesc.${k}`)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function translateError(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.categoryAttributes.form">>,
): string {
  const known = [
    "key_required",
    "key_invalid",
    "key_too_long",
    "key_exists",
    "label_required",
    "options_required",
    "options_too_many",
    "option_value_required",
    "option_value_invalid",
    "option_label_required",
    "range_invalid",
    "category_not_found",
    "not_found",
    "invalid_body",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`errors.${key as (typeof known)[number]}`);
  }
  return t("errors.generic");
}

interface OptionsEditorProps {
  options: OptionState[];
  onAdd: (next: OptionState) => void;
  onReplace: (idx: number, next: OptionState) => void;
  onRemove: (idx: number) => void;
  onMove: (idx: number, direction: -1 | 1) => void;
  disabled: boolean;
}

// Option-value slug использует snake_case через `lib/slugify`.

const EMPTY_OPTION: OptionState = { value: "", labelRu: "", labelUz: "", labelEn: "" };

type DialogState =
  | { open: false }
  | { open: true; mode: "add" }
  | { open: true; mode: "edit"; index: number; initial: OptionState };

function OptionsEditor({
  options,
  onAdd,
  onReplace,
  onRemove,
  onMove,
  disabled,
}: OptionsEditorProps): JSX.Element {
  const t = useTranslations("admin.categoryAttributes.form.options");
  const [dialog, setDialog] = useState<DialogState>({ open: false });

  const openAdd = (): void => setDialog({ open: true, mode: "add" });
  const openEdit = (index: number): void =>
    setDialog({ open: true, mode: "edit", index, initial: options[index]! });
  const closeDialog = (): void => setDialog({ open: false });

  const handleSave = (next: OptionState): void => {
    if (!dialog.open) return;
    if (dialog.mode === "add") onAdd(next);
    else onReplace(dialog.index, next);
    closeDialog();
  };

  // Список существующих value'ов для проверки дублей в dialog'е.
  const existingValues = options
    .map((o) => o.value.toLowerCase())
    .filter((_, i) => !(dialog.open && dialog.mode === "edit" && i === dialog.index));

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5" data-testid="admin-attr-options">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("subtitle", { count: options.length })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={openAdd}
          disabled={disabled}
          data-testid="admin-attr-options-add"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t("add")}
        </Button>
      </header>

      {options.length === 0 ? (
        <button
          type="button"
          onClick={openAdd}
          disabled={disabled}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          data-testid="admin-attr-options-empty-cta"
        >
          <Plus className="h-5 w-5" aria-hidden />
          <span>{t("emptyCta")}</span>
        </button>
      ) : (
        <ul className="grid gap-2">
          {options.map((opt, i) => (
            <OptionCard
              key={i}
              index={i}
              total={options.length}
              option={opt}
              onEdit={() => openEdit(i)}
              onRemove={() => onRemove(i)}
              onMove={(dir) => onMove(i, dir)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      <OptionDialog
        state={dialog}
        existingValues={existingValues}
        onSave={handleSave}
        onClose={closeDialog}
      />
    </section>
  );
}

interface OptionCardProps {
  index: number;
  total: number;
  option: OptionState;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  disabled: boolean;
}

function OptionCard({
  index,
  total,
  option,
  onEdit,
  onRemove,
  onMove,
  disabled,
}: OptionCardProps): JSX.Element {
  const t = useTranslations("admin.categoryAttributes.form.options");
  return (
    <li
      className="group flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 transition hover:border-foreground/20 hover:shadow-sm"
      data-testid={`admin-attr-option-${index}`}
    >
      {option.color ? (
        <span
          aria-hidden
          title={option.color}
          className="inline-block h-7 w-7 shrink-0 rounded-full ring-2 ring-inset ring-background shadow-sm"
          style={{ backgroundColor: option.color }}
        />
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
          {index + 1}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {option.labelRu || <span className="text-muted-foreground">{t("unnamed")}</span>}
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {option.value || "—"}
          </code>
          {option.color ? (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {option.color}
            </code>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            <span className="rounded-sm bg-muted/70 px-1 py-px font-mono text-[9px]">UZ</span>{" "}
            {option.labelUz || "—"}
          </span>
          <span>
            <span className="rounded-sm bg-muted/70 px-1 py-px font-mono text-[9px]">EN</span>{" "}
            {option.labelEn || "—"}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
          aria-label={t("moveUp")}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || index === total - 1}
          onClick={() => onMove(1)}
          aria-label={t("moveDown")}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled}
          onClick={onEdit}
          aria-label={t("edit")}
          data-testid={`admin-attr-option-${index}-edit`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          onClick={onRemove}
          aria-label={t("remove")}
          data-testid={`admin-attr-option-${index}-remove`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

interface OptionDialogProps {
  state: DialogState;
  existingValues: string[];
  onSave: (next: OptionState) => void;
  onClose: () => void;
}

function OptionDialog({ state, existingValues, onSave, onClose }: OptionDialogProps): JSX.Element {
  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        {state.open ? (
          <OptionDialogBody
            mode={state.mode}
            initial={state.mode === "edit" ? state.initial : EMPTY_OPTION}
            existingValues={existingValues}
            onSave={onSave}
            onCancel={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface OptionDialogBodyProps {
  mode: "add" | "edit";
  initial: OptionState;
  existingValues: string[];
  onSave: (next: OptionState) => void;
  onCancel: () => void;
}

function OptionDialogBody({
  mode,
  initial,
  existingValues,
  onSave,
  onCancel,
}: OptionDialogBodyProps): JSX.Element {
  const t = useTranslations("admin.categoryAttributes.form.options");
  const [draft, setDraft] = useState<OptionState>(initial);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof OptionState>(k: K, v: OptionState[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const handleRuBlur = (): void => {
    if (draft.value.trim() === "" && draft.labelRu.trim() !== "") {
      update("value", slugify(draft.labelRu, { separator: "_", maxLength: 64 }));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const v = draft.value.trim();
    if (v === "") return setError(t("errors.valueRequired"));
    if (!/^[a-z][a-z0-9_-]*$/.test(v)) return setError(t("errors.valueInvalid"));
    if (existingValues.includes(v.toLowerCase())) return setError(t("errors.valueDuplicate"));
    if (draft.labelRu.trim() === "") return setError(t("errors.labelRuRequired"));
    const color = draft.color?.trim();
    if (color && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
      return setError(t("errors.colorInvalid"));
    }
    onSave({
      value: v,
      labelRu: draft.labelRu.trim(),
      labelUz: draft.labelUz.trim(),
      labelEn: draft.labelEn.trim(),
      ...(color ? { color } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="admin-attr-option-dialog">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? t("addTitle") : t("editTitle")}</DialogTitle>
        <DialogDescription>{t("dialogSubtitle")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="opt-dlg-ru" className="flex items-center gap-1.5 text-xs">
            <span className="rounded-sm bg-muted px-1 py-px font-mono text-[9px]">RU</span>
            {t("labelRu")}
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="opt-dlg-ru"
            value={draft.labelRu}
            onChange={(e) => update("labelRu", e.target.value)}
            onBlur={handleRuBlur}
            maxLength={80}
            required
            autoFocus
            data-testid="admin-attr-option-dialog-ru"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="opt-dlg-uz" className="flex items-center gap-1.5 text-xs">
              <span className="rounded-sm bg-muted px-1 py-px font-mono text-[9px]">UZ</span>
              {t("labelUz")}
            </Label>
            <Input
              id="opt-dlg-uz"
              value={draft.labelUz}
              onChange={(e) => update("labelUz", e.target.value)}
              maxLength={80}
              placeholder={draft.labelRu}
              data-testid="admin-attr-option-dialog-uz"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opt-dlg-en" className="flex items-center gap-1.5 text-xs">
              <span className="rounded-sm bg-muted px-1 py-px font-mono text-[9px]">EN</span>
              {t("labelEn")}
            </Label>
            <Input
              id="opt-dlg-en"
              value={draft.labelEn}
              onChange={(e) => update("labelEn", e.target.value)}
              maxLength={80}
              placeholder={draft.labelRu}
              data-testid="admin-attr-option-dialog-en"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opt-dlg-value" className="text-xs">
            {t("value")}
          </Label>
          <Input
            id="opt-dlg-value"
            value={draft.value}
            onChange={(e) =>
              update("value", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
            }
            placeholder="cotton"
            className="font-mono text-xs"
            maxLength={64}
            data-testid="admin-attr-option-dialog-value"
          />
          <p className="text-[10px] text-muted-foreground">{t("valueHint")}</p>
        </div>

        {/* Color: opt-in. When set, this option рендерится swatch'ом в filter UI. */}
        <div className="space-y-1.5">
          <Label htmlFor="opt-dlg-color" className="text-xs">
            {t("color")}
          </Label>
          <div className="flex items-center gap-2">
            {/* Native color picker — keeps draft.color in sync */}
            <input
              type="color"
              aria-label={t("colorPicker")}
              value={draft.color && /^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : "#cccccc"}
              onChange={(e) => update("color", e.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background"
              data-testid="admin-attr-option-dialog-color-picker"
            />
            <Input
              id="opt-dlg-color"
              value={draft.color ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                update("color", v === "" ? undefined : (v as OptionState["color"]));
              }}
              placeholder="#ef4444"
              className="font-mono text-xs"
              maxLength={7}
              data-testid="admin-attr-option-dialog-color"
            />
            {draft.color ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => update("color", undefined)}
                data-testid="admin-attr-option-dialog-color-clear"
              >
                {t("colorClear")}
              </Button>
            ) : null}
          </div>
          <p className="text-[10px] text-muted-foreground">{t("colorHint")}</p>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="admin-attr-option-dialog-error"
        >
          {error}
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" data-testid="admin-attr-option-dialog-save">
          {mode === "add" ? t("save") : t("apply")}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface RangeEditorProps {
  state: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  disabled: boolean;
}

function RangeEditor({ state, update, disabled }: RangeEditorProps): JSX.Element {
  const t = useTranslations("admin.categoryAttributes.form.range");
  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="admin-attr-range">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="min">{t("min")}</Label>
          <Input
            id="min"
            type="number"
            value={state.min}
            onChange={(e) => update("min", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max">{t("max")}</Label>
          <Input
            id="max"
            type="number"
            value={state.max}
            onChange={(e) => update("max", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="step">{t("step")}</Label>
          <Input
            id="step"
            type="number"
            min={0}
            step="any"
            value={state.step}
            onChange={(e) => update("step", e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["ru", "uz", "en"] as const).map((loc) => {
          const k = `unit${cap(loc)}` as "unitRu" | "unitUz" | "unitEn";
          return (
            <div key={loc} className="space-y-1.5">
              <Label htmlFor={`unit-${loc}`}>{t(`unit.${loc}`)}</Label>
              <Input
                id={`unit-${loc}`}
                maxLength={20}
                value={state[k]}
                onChange={(e) => update(k, e.target.value)}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
