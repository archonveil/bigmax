"use client";

/**
 * `<CategoryAttributesEditor>` — DB-driven UI-секция в `<ProductForm>` для
 * редактирования `Product.attributes` (Json) согласно конфигу из
 * `CategoryAttribute`-таблицы.
 *
 * **Контракт**:
 *  - `configs` приходит из ProductForm (resolved для текущей выбранной
 *    категории). При смене категории parent передаёт новый массив, UI
 *    перерисовывается.
 *  - `value` — `Record<string, AttributeValue>` (sub-state в parent'е).
 *  - `onChange(next)` — сигналим parent'у новое значение полностью.
 *  - При смене config'а old keys остаются (backend silent-ignores unknown).
 *
 * Field rendering по `kind`:
 *  - `enum`        → `<select>`.
 *  - `multiselect` → multi-checkbox список.
 *  - `range`       → `<input type="number" min/max/step>` с unit-suffix.
 *  - `boolean`     → `<input type="checkbox">`.
 *  - `text`        → free-form `<input type="text">`.
 *
 * Required + helpText рендерятся per-field. Per-locale label/helpText/unit
 * берём через `pickLabel`/`pickHelpText`/`pickOptionLabel`/`pickUnit`.
 */

import type { Locale } from "@bigmax/shared-types";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  pickHelpText,
  pickLabel,
  pickOptionLabel,
  pickUnit,
  type AttributeOption,
  type AttributeValue,
  type CategoryAttributeConfig,
} from "@/catalog/category-attributes";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QuickAttributeOptionDialog = dynamic(
  () =>
    import("@/components/admin/products/quick-attribute-option-dialog").then(
      (m) => m.QuickAttributeOptionDialog,
    ),
  { ssr: false },
);

interface Props {
  configs: readonly CategoryAttributeConfig[];
  value: Record<string, AttributeValue> | null | undefined;
  onChange: (next: Record<string, AttributeValue>) => void;
  locale: Locale;
  disabled?: boolean;
  /** Имя выбранной категории — показывается в подзаголовке секции. */
  categoryName?: string;
  /** Произвольный CTA в нижней части секции (обычно — `+ Создать характеристику`). */
  footerAction?: React.ReactNode;
}

export function CategoryAttributesEditor({
  configs,
  value,
  onChange,
  locale,
  disabled,
  categoryName,
  footerAction,
}: Props): JSX.Element {
  const tForm = useTranslations("admin.products.form");
  const current = value ?? {};

  const update = (key: string, v: AttributeValue | undefined): void => {
    const next = { ...current };
    if (v === undefined) {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  };

  // `color` — derived field: значения берутся из вариантов товара, admin
  // не редактирует его в product-форме. Убираем из списка editable полей.
  // Display-индикатор (auto-derived hint) рендерится отдельно ниже.
  const editable = configs.filter((c) => c.key !== "color");
  const hasDerivedColor = configs.some((c) => c.key === "color");

  const renderHeader = (): JSX.Element => (
    <header className="space-y-0.5 border-b pb-3">
      <h3 className="text-sm font-semibold">{tForm("attributes.title")}</h3>
      {categoryName ? (
        <p className="text-xs text-muted-foreground">
          {tForm("attributes.subtitle", { category: categoryName })}
        </p>
      ) : null}
    </header>
  );

  if (editable.length === 0 && !hasDerivedColor) {
    return (
      <section
        className="space-y-4 rounded-lg border bg-card p-4"
        data-testid="product-form-attributes-empty"
      >
        {renderHeader()}
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {tForm("attributes.empty")}
        </p>
        {footerAction}
      </section>
    );
  }

  return (
    <section
      className="space-y-4 rounded-lg border bg-card p-4"
      data-testid="product-form-attributes"
    >
      {renderHeader()}
      {editable.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {editable.map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              value={current[field.key]}
              onUpdate={update}
              locale={locale}
              disabled={disabled ?? false}
            />
          ))}
        </div>
      ) : null}
      {hasDerivedColor ? (
        <p
          className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          data-testid="product-form-color-derived-hint"
        >
          {tForm("attributes.colorDerivedHint")}
        </p>
      ) : null}
      {footerAction}
    </section>
  );
}

interface RowProps {
  field: CategoryAttributeConfig;
  value: AttributeValue | undefined;
  onUpdate: (key: string, v: AttributeValue | undefined) => void;
  locale: Locale;
  disabled: boolean;
}

function FieldRow({ field, value, onUpdate, locale, disabled }: RowProps): JSX.Element {
  const id = `attr-${field.key}`;
  const label = pickLabel(field, locale);
  const helpText = pickHelpText(field, locale);
  const tForm = useTranslations("admin.products.form");
  const [optDialogOpen, setOptDialogOpen] = useState(false);
  // Optimistic-only список новых option'ов для этого attribute. После
  // create мы добавляем сюда и ререндерим dropdown сразу — без RSC refresh.
  const [extraOptions, setExtraOptions] = useState<AttributeOption[]>([]);

  // Merged list of options — server-side + only-new optimistic (deduped by
  // `value`). Только enum/multiselect имеют `options`; для прочих kind'ов
  // возвращаем пустой массив, чтобы тип сошёлся.
  const effectiveOptions: readonly AttributeOption[] = useMemo(() => {
    const base: readonly AttributeOption[] =
      field.kind === "enum" || field.kind === "multiselect" ? field.options : [];
    if (extraOptions.length === 0) return base;
    const seen = new Set(base.map((o) => o.value.toLowerCase()));
    const onlyNew = extraOptions.filter((o) => !seen.has(o.value.toLowerCase()));
    return [...base, ...onlyNew];
  }, [field, extraOptions]);

  const onOptionCreated = (opt: AttributeOption): void => {
    setExtraOptions((prev) => [...prev, opt]);
    if (field.kind === "enum") {
      onUpdate(field.key, opt.value);
    } else if (field.kind === "multiselect") {
      const current = Array.isArray(value) ? value : [];
      onUpdate(field.key, [...current, opt.value]);
    }
  };

  const renderLabel = (): JSX.Element => (
    <Label htmlFor={id}>
      {label}
      {field.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
      {field.kind === "range" ? <RangeUnit field={field} locale={locale} /> : null}
    </Label>
  );

  const renderHelp = (): JSX.Element | null =>
    helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null;

  if (field.kind === "enum") {
    const strVal = typeof value === "string" ? value : "";
    const ANY = "__any__";
    const ADD_NEW = "__add_new__";
    return (
      <div className="space-y-1.5">
        {renderLabel()}
        <Select
          value={strVal === "" ? ANY : strVal}
          onValueChange={(v) => {
            if (v === ADD_NEW) {
              // Не меняем field.value — открываем dialog. Radix Select закроется
              // сам (focus уйдёт в Dialog), что и нужно.
              setOptDialogOpen(true);
              return;
            }
            onUpdate(field.key, v === ANY ? undefined : v);
          }}
          disabled={disabled}
        >
          <SelectTrigger id={id} data-testid={`product-form-attr-${field.key}`}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {/* In-dropdown CTA: special sentinel-value SelectItem styled as
                accent action; intercepted in onValueChange. Сверху, чтобы
                юзер видел действие первым. */}
            <SelectItem
              value={ADD_NEW}
              data-testid={`product-form-attr-${field.key}-add`}
              className="mb-1 border-b border-border bg-accent/30 font-medium text-primary focus:bg-accent/60"
            >
              <span className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {tForm("attributes.addOption")}
              </span>
            </SelectItem>
            <SelectItem value={ANY}>—</SelectItem>
            {effectiveOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="flex items-center gap-2">
                  {o.color ? (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                      style={{ backgroundColor: o.color }}
                    />
                  ) : null}
                  {pickOptionLabel(o, locale)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <QuickAttributeOptionDialog
          attributeCategoryId={field.categoryId}
          attributeId={field.id}
          attributeLabel={label}
          existingOptions={effectiveOptions}
          onCreated={onOptionCreated}
          open={optDialogOpen}
          onOpenChange={setOptDialogOpen}
        />
        {renderHelp()}
      </div>
    );
  }

  if (field.kind === "multiselect") {
    const arrVal: string[] = Array.isArray(value) ? value : [];
    const toggle = (v: string): void => {
      const next = arrVal.includes(v) ? arrVal.filter((x) => x !== v) : [...arrVal, v];
      onUpdate(field.key, next.length === 0 ? undefined : next);
    };
    return (
      <div className="space-y-1.5">
        {renderLabel()}
        <ul data-testid={`product-form-attr-${field.key}`} className="flex flex-wrap gap-2">
          {effectiveOptions.map((o) => {
            const checked = arrVal.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  disabled={disabled}
                  aria-pressed={checked}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:border-foreground/30 hover:bg-muted"
                  }`}
                >
                  {pickOptionLabel(o, locale)}
                </button>
              </li>
            );
          })}
          <li>
            <QuickAttributeOptionDialog
              attributeCategoryId={field.categoryId}
              attributeId={field.id}
              attributeLabel={label}
              existingOptions={effectiveOptions}
              onCreated={onOptionCreated}
              trigger={
                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`product-form-attr-${field.key}-add`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/30 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {tForm("attributes.addOption")}
                </button>
              }
            />
          </li>
        </ul>
        {renderHelp()}
      </div>
    );
  }

  if (field.kind === "range") {
    const numVal = typeof value === "number" ? String(value) : "";
    return (
      <div className="space-y-1.5">
        {renderLabel()}
        <Input
          id={id}
          data-testid={`product-form-attr-${field.key}`}
          type="number"
          {...(field.min !== null ? { min: field.min } : {})}
          {...(field.max !== null ? { max: field.max } : {})}
          {...(field.step !== null ? { step: field.step } : {})}
          value={numVal}
          required={field.isRequired}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onUpdate(field.key, undefined);
              return;
            }
            const n = Number.parseFloat(raw);
            if (Number.isFinite(n)) onUpdate(field.key, n);
          }}
          disabled={disabled}
        />
        {renderHelp()}
      </div>
    );
  }

  if (field.kind === "text") {
    const strVal = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1.5">
        {renderLabel()}
        <Input
          id={id}
          data-testid={`product-form-attr-${field.key}`}
          type="text"
          maxLength={500}
          required={field.isRequired}
          value={strVal}
          onChange={(e) => onUpdate(field.key, e.target.value === "" ? undefined : e.target.value)}
          disabled={disabled}
        />
        {renderHelp()}
      </div>
    );
  }

  // boolean
  const boolVal = typeof value === "boolean" ? value : false;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          data-testid={`product-form-attr-${field.key}`}
          checked={boolVal}
          onCheckedChange={(v) => onUpdate(field.key, v === true ? true : undefined)}
          disabled={disabled}
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
          {field.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
      </div>
      {renderHelp()}
    </div>
  );
}

function RangeUnit({
  field,
  locale,
}: {
  field: Extract<CategoryAttributeConfig, { kind: "range" }>;
  locale: Locale;
}): JSX.Element | null {
  const unit = pickUnit(field, locale);
  if (!unit) return null;
  return <span className="ml-1 text-xs text-muted-foreground">({unit})</span>;
}
