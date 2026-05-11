"use client";

/**
 * `<CategoryFilters>` — sidebar фильтров каталога. Advanced UI:
 *   - **Active chips** наверху: pill'ы по каждому applied filter'у с X-кнопкой
 *     для individual remove. Click → debounce-free push нужного filter'а.
 *   - **Collapsible sections** с section-icon + count-badge: admin может
 *     свернуть section'ы что не релевантны.
 *   - **Brand search** + **show-more** при большом списке (>5 показывает
 *     show-more, >6 — search input).
 *   - **InStock** toggle вынесен в отдельный highlighted card с акцентным
 *     border'ом — отличается от обычного checkbox'а.
 *
 * State архитектура такая же что и раньше: local `useState` — source of
 * truth для UI, с debounce-push'ом в URL. `pending` → `aria-busy`.
 */

import type { Locale } from "@bigmax/shared-types";
import {
  Baby,
  Box,
  ChevronDown,
  CircleUser,
  Search,
  Sliders,
  Tag,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import {
  isColorField,
  pickHelpText,
  pickLabel,
  pickOptionLabel,
  pickUnit,
  type CategoryAttributeConfig,
} from "@/catalog/category-attributes";
import {
  AGE_PRESETS,
  buildFiltersQueryString,
  GENDER_FILTERS,
  type AgePreset,
  type AttributeFilters,
  type CategoryFilters,
  type GenderFilter,
} from "@/catalog/filters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFilterUrl } from "@/lib/use-filter-url";
import { cn } from "@/lib/utils";

interface BrandOption {
  slug: string;
  name: string;
}

interface CategoryFiltersProps {
  initial: CategoryFilters;
  initialAttributes: AttributeFilters;
  brands: BrandOption[];
  attributeConfigs: readonly CategoryAttributeConfig[];
  locale: Locale;
}

const DEBOUNCE_MS = 500;
const BRAND_COLLAPSE_THRESHOLD = 5;
const BRAND_SEARCH_THRESHOLD = 7;

export function CategoryFilters({
  initial,
  initialAttributes,
  brands,
  attributeConfigs,
  locale,
}: CategoryFiltersProps): JSX.Element {
  const t = useTranslations("catalog.filters");
  const tAttr = useTranslations("attributes");
  const searchParams = useSearchParams();
  const { applyParams, isPending: pending } = useFilterUrl();
  const filterableConfigs = attributeConfigs.filter((c) => c.isFilterable);

  const [state, setState] = useState<CategoryFilters>(initial);
  const [attrState, setAttrState] = useState<AttributeFilters>(initialAttributes);

  const debounceTimer = useRef<number | null>(null);

  function pushFilters(next: CategoryFilters, nextAttrs: AttributeFilters, debounce = false): void {
    const params = new URLSearchParams(buildFiltersQueryString(next, nextAttrs));
    const pageSize = searchParams.get("pageSize");
    if (pageSize) params.set("pageSize", pageSize);
    const sort = searchParams.get("sort");
    if (sort) params.set("sort", sort);

    if (debounce) {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => {
        debounceTimer.current = null;
        applyParams(params);
      }, DEBOUNCE_MS);
    } else {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      applyParams(params);
    }
  }

  function update(patch: Partial<CategoryFilters>, debounce = false): void {
    const next = { ...state, ...patch };
    setState(next);
    pushFilters(next, attrState, debounce);
  }

  function updateAttr(
    key: string,
    value: string | string[] | { min?: number; max?: number } | null,
  ): void {
    const next: AttributeFilters = { ...attrState };
    if (
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        value.min === undefined &&
        value.max === undefined)
    ) {
      delete next[key];
    } else {
      next[key] = value;
    }
    setAttrState(next);
    // Range-фильтры дебаунсим (number-input → много изменений), enum/multiselect — нет.
    const isRange = typeof value === "object" && !Array.isArray(value);
    pushFilters(state, next, isRange);
  }

  /** Toggle одного значения в multiselect-наборе attribute-фильтра. */
  function toggleAttrMulti(key: string, value: string): void {
    const cur = attrState[key];
    let curArr: string[];
    if (Array.isArray(cur)) curArr = cur;
    else if (typeof cur === "string" && cur !== "") curArr = [cur];
    else curArr = [];
    const exists = curArr.includes(value);
    const nextArr = exists ? curArr.filter((v) => v !== value) : [...curArr, value];
    if (nextArr.length === 0) updateAttr(key, null);
    else if (nextArr.length === 1) updateAttr(key, nextArr[0]!);
    else updateAttr(key, nextArr);
  }

  function reset(): void {
    const cleared: CategoryFilters = {
      minPrice: undefined,
      maxPrice: undefined,
      brand: [],
      age: "any",
      gender: "any",
      inStock: false,
    };
    setState(cleared);
    setAttrState({});
    pushFilters(cleared, {});
  }

  function toggleBrand(slug: string): void {
    const next = state.brand.includes(slug)
      ? state.brand.filter((b) => b !== slug)
      : [...state.brand, slug];
    update({ brand: next });
  }

  // ---- Active filter chips ----
  const chips: Chip[] = [];
  // Price chips (combined into one if both bounds set, separate otherwise).
  if (state.minPrice !== undefined && state.maxPrice !== undefined) {
    chips.push({
      id: "price",
      label: t("priceLabel", {
        min: formatPrice(state.minPrice),
        max: formatPrice(state.maxPrice),
      }),
      onRemove: () => update({ minPrice: undefined, maxPrice: undefined }),
    });
  } else if (state.minPrice !== undefined) {
    chips.push({
      id: "price-min",
      label: t("priceLabelMin", { min: formatPrice(state.minPrice) }),
      onRemove: () => update({ minPrice: undefined }),
    });
  } else if (state.maxPrice !== undefined) {
    chips.push({
      id: "price-max",
      label: t("priceLabelMax", { max: formatPrice(state.maxPrice) }),
      onRemove: () => update({ maxPrice: undefined }),
    });
  }
  // Brand chips (one per selected brand).
  for (const slug of state.brand) {
    const b = brands.find((br) => br.slug === slug);
    if (!b) continue;
    chips.push({
      id: `brand-${slug}`,
      label: b.name,
      onRemove: () => toggleBrand(slug),
    });
  }
  // Age / gender / inStock.
  if (state.age !== "any") {
    chips.push({
      id: "age",
      label: t(`ages.${state.age}`),
      onRemove: () => update({ age: "any" }),
    });
  }
  if (state.gender !== "any") {
    chips.push({
      id: "gender",
      label: t(`genders.${state.gender}`),
      onRemove: () => update({ gender: "any" }),
    });
  }
  if (state.inStock) {
    chips.push({
      id: "inStock",
      label: t("inStock"),
      onRemove: () => update({ inStock: false }),
    });
  }
  // Attribute chips.
  for (const cfg of filterableConfigs) {
    const v = attrState[cfg.key];
    if (v === undefined) continue;
    if (typeof v === "string") {
      let label = pickLabel(cfg, locale);
      let swatch: string | undefined;
      if (cfg.kind === "enum" || cfg.kind === "multiselect") {
        const opt = cfg.options.find((o) => o.value === v);
        if (opt) {
          // Если все опции цветные — chip показывает только название цвета
          // (поле уже понятно из swatch + контекста). Иначе — "Метка: значение".
          label = isColorField(cfg)
            ? pickOptionLabel(opt, locale)
            : `${label}: ${pickOptionLabel(opt, locale)}`;
          if (opt.color) swatch = opt.color;
        }
      } else if (cfg.kind === "boolean") {
        if (v !== "true") continue;
      }
      chips.push({
        id: `attr-${cfg.key}`,
        label,
        ...(swatch ? { swatch } : {}),
        onRemove: () => updateAttr(cfg.key, null),
      });
    } else if (Array.isArray(v)) {
      // Multiselect: один chip на каждое выбранное значение, чтобы юзер
      // мог удалить отдельный пункт без сброса всего набора.
      if (cfg.kind !== "enum" && cfg.kind !== "multiselect") continue;
      for (const item of v) {
        const opt = cfg.options.find((o) => o.value === item);
        if (!opt) continue;
        const baseLabel = pickLabel(cfg, locale);
        const optLabel = pickOptionLabel(opt, locale);
        const label = isColorField(cfg) ? optLabel : `${baseLabel}: ${optLabel}`;
        chips.push({
          id: `attr-${cfg.key}-${item}`,
          label,
          ...(opt.color ? { swatch: opt.color } : {}),
          onRemove: () => toggleAttrMulti(cfg.key, item),
        });
      }
    } else if (typeof v === "object" && cfg.kind === "range") {
      const baseLabel = pickLabel(cfg, locale);
      let suffix = "";
      if (v.min !== undefined && v.max !== undefined) {
        suffix = `${formatPrice(v.min)}–${formatPrice(v.max)}`;
      } else if (v.min !== undefined) {
        suffix = `≥${formatPrice(v.min)}`;
      } else if (v.max !== undefined) {
        suffix = `≤${formatPrice(v.max)}`;
      }
      if (suffix === "") continue;
      chips.push({
        id: `attr-${cfg.key}`,
        label: `${baseLabel}: ${suffix}`,
        onRemove: () => updateAttr(cfg.key, null),
      });
    }
  }
  const activeCount = chips.length;

  return (
    <aside className="space-y-3" aria-busy={pending}>
      {/* ----- Active chips + reset (sticky на verхней границе scrollable
              parent'а) — даёт юзеру всегда-доступный «Сбросить» при scroll'е
              сквозь длинный список атрибутов. */}
      {chips.length > 0 ? (
        <div
          className="sticky top-0 z-10 -mx-3 -mt-3 space-y-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/75"
          aria-label={t("activeTitle")}
          data-testid="catalog-filter-active-chips"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("activeTitle")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto py-1 text-xs"
              onClick={reset}
            >
              {t("resetCount", { count: activeCount })}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <ActiveChip
                key={c.id}
                label={c.label}
                {...(c.swatch ? { swatch: c.swatch } : {})}
                ariaLabel={t("remove")}
                onRemove={c.onRemove}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ----- In-stock toggle (highlighted, on top) ----- */}
      <InStockCard
        label={t("inStock")}
        hint={t("inStockHint")}
        checked={state.inStock}
        onChange={(v) => update({ inStock: v })}
      />

      {/* ----- Sections ----- */}
      <div className="divide-y rounded-lg border">
        <FilterSection icon={Wallet} title={t("price")} count={priceCount(state)} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <PriceInput
              ariaLabel={t("priceFrom")}
              prefix={t("priceFrom")}
              value={state.minPrice}
              onChange={(n) => update({ minPrice: n }, true)}
            />
            <PriceInput
              ariaLabel={t("priceTo")}
              prefix={t("priceTo")}
              value={state.maxPrice}
              onChange={(n) => update({ maxPrice: n }, true)}
            />
          </div>
        </FilterSection>

        {brands.length > 0 ? (
          <FilterSection
            icon={Tag}
            title={t("brand")}
            count={state.brand.length}
            defaultOpen={state.brand.length > 0}
          >
            <BrandList brands={brands} selected={state.brand} onToggle={toggleBrand} t={t} />
          </FilterSection>
        ) : null}

        <FilterSection icon={Baby} title={t("age")} count={state.age !== "any" ? 1 : 0}>
          <Select value={state.age} onValueChange={(v) => update({ age: v as AgePreset })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGE_PRESETS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`ages.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <FilterSection icon={CircleUser} title={t("gender")} count={state.gender !== "any" ? 1 : 0}>
          <Select value={state.gender} onValueChange={(v) => update({ gender: v as GenderFilter })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENDER_FILTERS.map((g) => (
                <SelectItem key={g} value={g}>
                  {t(`genders.${g}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        {filterableConfigs.map((field) => {
          const value = attrState[field.key];
          const has =
            value !== undefined &&
            !(Array.isArray(value) && value.length === 0) &&
            !(
              typeof value === "object" &&
              !Array.isArray(value) &&
              value.min === undefined &&
              value.max === undefined
            );
          const count = Array.isArray(value) ? value.length : has ? 1 : 0;
          return (
            <FilterSection
              key={field.id}
              icon={field.kind === "range" ? Sliders : Box}
              title={pickLabel(field, locale)}
              count={count}
              defaultOpen={has}
            >
              <AttributeField
                field={field}
                locale={locale}
                value={value}
                onChange={(v) => updateAttr(field.key, v)}
                onToggleMulti={(v) => toggleAttrMulti(field.key, v)}
                tAttr={tAttr}
                tFilters={t}
              />
            </FilterSection>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Active chips
// ---------------------------------------------------------------------------

interface Chip {
  id: string;
  label: string;
  /** Опц. hex — рендерится swatch'ем перед label'ом (для color-фильтров). */
  swatch?: string;
  onRemove: () => void;
}

function ActiveChip({
  label,
  swatch,
  ariaLabel,
  onRemove,
}: {
  label: string;
  swatch?: string;
  ariaLabel: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`${ariaLabel}: ${label}`}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary",
        "transition-colors duration-150 hover:bg-primary/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      )}
    >
      {swatch ? (
        <span
          aria-hidden
          className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-primary/30"
          style={{ backgroundColor: swatch }}
        />
      ) : null}
      <span>{label}</span>
      <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

interface FilterSectionProps {
  icon: LucideIcon;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function FilterSection({
  icon: Icon,
  title,
  count,
  defaultOpen = true,
  children,
}: FilterSectionProps): JSX.Element {
  const t = useTranslations("catalog.filters");
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${title} — ${open ? t("collapse") : t("expand")}`}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md py-1 text-sm font-medium",
          "transition-colors duration-150 hover:text-foreground/80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        )}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>{title}</span>
          {count > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? <div className="space-y-2 pt-3">{children}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// In-stock highlighted card
// ---------------------------------------------------------------------------

function InStockCard({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors duration-150",
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-input bg-card hover:border-foreground/20 hover:bg-accent/30",
      )}
    >
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-tight">{label}</span>
        <span className="text-xs leading-tight text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Price input with prefix
// ---------------------------------------------------------------------------

function PriceInput({
  ariaLabel,
  prefix,
  value,
  onChange,
}: {
  ariaLabel: string;
  prefix: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}): JSX.Element {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {prefix}
      </span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={ariaLabel}
        className="pl-9 text-sm"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          const n = v === "" ? undefined : Number.parseInt(v, 10);
          onChange(Number.isFinite(n as number) ? (n as number) : undefined);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand list with search + show-more
// ---------------------------------------------------------------------------

interface BrandListProps {
  brands: BrandOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  t: ReturnType<typeof useTranslations<"catalog.filters">>;
}

function BrandList({ brands, selected, onToggle, t }: BrandListProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, query]);

  // Selected brands always show; rest collapse if total > threshold.
  const selectedSet = new Set(selected);
  const ordered = useMemo(() => {
    const sel = filtered.filter((b) => selectedSet.has(b.slug));
    const rest = filtered.filter((b) => !selectedSet.has(b.slug));
    return [...sel, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selected.join(",")]);

  const showSearch = brands.length > BRAND_SEARCH_THRESHOLD;
  const overflowing = ordered.length > BRAND_COLLAPSE_THRESHOLD;
  const visible = expanded || query !== "" ? ordered : ordered.slice(0, BRAND_COLLAPSE_THRESHOLD);
  const hidden = ordered.length - visible.length;

  return (
    <div className="space-y-2">
      {showSearch ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("brandSearch")}
            className="h-9 pl-8 text-sm"
            data-testid="catalog-filter-brand-search"
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">{t("brandNoMatches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((b) => {
            const checked = selectedSet.has(b.slug);
            return (
              <li key={b.slug}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm",
                    "transition-colors duration-150 hover:bg-accent/40",
                    checked && "text-foreground",
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(b.slug)} />
                  <span className="truncate" title={b.name}>
                    {b.name}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {overflowing && query === "" ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t("brandShowLess") : t("brandShowMore", { count: hidden })}
        </Button>
      ) : null}
    </div>
  );
}

function priceCount(s: CategoryFilters): number {
  let n = 0;
  if (s.minPrice !== undefined) n += 1;
  if (s.maxPrice !== undefined) n += 1;
  return n;
}

/** Format integer price with thin-space thousand separators (RU/UZ/EN locale-safe). */
function formatPrice(n: number): string {
  return n.toLocaleString("ru-RU");
}

/** Crude luminance check — true if hex is "light" enough that white
 *  check-icon stroke would have low contrast. Flips between light/dark. */
function isLightHex(hex: string): boolean {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6;
}

// ---------------------------------------------------------------------------
// Per-attribute field renderer (ENUM / BOOLEAN / RANGE)
// ---------------------------------------------------------------------------

interface AttributeFieldProps {
  field: CategoryAttributeConfig;
  locale: Locale;
  value: string | string[] | { min?: number; max?: number } | undefined;
  onChange: (v: string | string[] | { min?: number; max?: number } | null) => void;
  /** Toggle одного значения в multiselect-наборе. */
  onToggleMulti: (v: string) => void;
  tAttr: ReturnType<typeof useTranslations<"attributes">>;
  tFilters: ReturnType<typeof useTranslations<"catalog.filters">>;
}

const ANY_SENTINEL = "__any__";

function AttributeField({
  field,
  locale,
  value,
  onChange,
  onToggleMulti,
  tAttr,
  tFilters,
}: AttributeFieldProps): JSX.Element {
  const id = `filter-${field.key}`;
  const helpText = pickHelpText(field, locale);

  // Color picker (enum + multiselect одинаково — swatch grid). Для enum:
  // single-select (radio) — клик по выбранному снимает выделение. Для
  // multiselect: multi-toggle (checkbox-семантика) — клик добавляет/убирает.
  if ((field.kind === "enum" || field.kind === "multiselect") && isColorField(field)) {
    const isMulti = field.kind === "multiselect";
    const selectedValues = (() => {
      if (Array.isArray(value)) return new Set(value);
      if (typeof value === "string" && value !== "") return new Set([value]);
      return new Set<string>();
    })();
    const selectedLabels = field.options
      .filter((o) => selectedValues.has(o.value))
      .map((o) => pickOptionLabel(o, locale));
    return (
      <div className="space-y-2">
        <ul
          className="flex flex-wrap gap-1.5"
          role={isMulti ? "group" : "radiogroup"}
          aria-label={pickLabel(field, locale)}
          data-testid={`filter-${field.key}-swatches`}
        >
          {field.options.map((opt) => {
            const selected = selectedValues.has(opt.value);
            const label = pickOptionLabel(opt, locale);
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  {...(isMulti
                    ? { "aria-pressed": selected }
                    : { role: "radio", "aria-checked": selected })}
                  aria-label={label}
                  title={label}
                  onClick={() => {
                    if (isMulti) onToggleMulti(opt.value);
                    else onChange(selected ? null : opt.value);
                  }}
                  className={cn(
                    "relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "hover:scale-110",
                    selected
                      ? "ring-2 ring-primary ring-offset-2 scale-110"
                      : "ring-1 ring-inset ring-border",
                  )}
                  style={{ backgroundColor: opt.color }}
                >
                  {selected ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 drop-shadow-sm"
                      aria-hidden
                      fill="none"
                      stroke={isLightHex(opt.color!) ? "#111827" : "#ffffff"}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {selectedLabels.length > 0 ? (
          <p className="text-xs text-muted-foreground">{selectedLabels.join(", ")}</p>
        ) : null}
        {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      </div>
    );
  }

  if (field.kind === "multiselect") {
    // Non-color multiselect: chip-list checkboxes.
    const selectedValues = Array.isArray(value)
      ? new Set(value)
      : typeof value === "string" && value !== ""
        ? new Set([value])
        : new Set<string>();
    return (
      <div className="space-y-2">
        <ul
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={pickLabel(field, locale)}
          data-testid={`filter-${field.key}-multi`}
        >
          {field.options.map((opt) => {
            const selected = selectedValues.has(opt.value);
            const label = pickOptionLabel(opt, locale);
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggleMulti(opt.value)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:border-foreground/30 hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
        {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      </div>
    );
  }

  if (field.kind === "enum") {
    const current = typeof value === "string" ? value : null;
    // Default: dropdown.
    return (
      <div className="space-y-2">
        <Select
          value={current ?? ANY_SENTINEL}
          onValueChange={(v) => onChange(v === ANY_SENTINEL ? null : v)}
        >
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_SENTINEL}>{tAttr("any")}</SelectItem>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  {opt.color ? (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                      style={{ backgroundColor: opt.color }}
                    />
                  ) : null}
                  {pickOptionLabel(opt, locale)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      </div>
    );
  }

  if (field.kind === "boolean") {
    const checked = value === "true";
    return (
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onChange(v === true ? "true" : null)}
          />
          <span>{pickLabel(field, locale)}</span>
        </label>
        {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      </div>
    );
  }

  if (field.kind === "range") {
    const range: { min?: number; max?: number } =
      typeof value === "object" && !Array.isArray(value) ? value : {};
    const unit = pickUnit(field, locale);
    return (
      <div className="space-y-2">
        {unit ? <p className="text-xs text-muted-foreground">{unit}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <PriceInput
            ariaLabel={tFilters("priceFrom")}
            prefix={tFilters("priceFrom")}
            value={range.min}
            onChange={(n) => {
              const next: { min?: number; max?: number } = {};
              if (n !== undefined) next.min = n;
              if (range.max !== undefined) next.max = range.max;
              onChange(next.min === undefined && next.max === undefined ? null : next);
            }}
          />
          <PriceInput
            ariaLabel={tFilters("priceTo")}
            prefix={tFilters("priceTo")}
            value={range.max}
            onChange={(n) => {
              const next: { min?: number; max?: number } = {};
              if (range.min !== undefined) next.min = range.min;
              if (n !== undefined) next.max = n;
              onChange(next.min === undefined && next.max === undefined ? null : next);
            }}
          />
        </div>
        {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      </div>
    );
  }

  return <></>;
}
