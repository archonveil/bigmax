"use client";

import { localized, type Locale } from "@bigmax/shared-types";
import { useTranslations } from "next-intl";

import {
  pickLabel,
  pickOptionLabel,
  pickUnit,
  type CategoryAttributeConfig,
} from "@/catalog/category-attributes";
import { cn } from "@/lib/utils";
import type { ProductDetail } from "@/server/catalog";

interface AttributesTableProps {
  product: ProductDetail;
  locale: Locale;
  /** DB-driven attribute-config для категории продукта. SSR-page фетчит. */
  attributeConfigs: readonly CategoryAttributeConfig[];
  /** `compact` — для Quick View: меньший отступ сверху, одноколоночные пары. */
  variant?: "default" | "compact";
}

interface Row {
  label: string;
  /** Plain text or JSX (e.g. swatch + label for color attributes). */
  value: React.ReactNode;
  /** Stable key for React iteration — usually the label. */
  key: string;
}

function formatAge(
  from: number | null,
  to: number | null,
  t: {
    ageRange: (p: { from: number; to: number }) => string;
    ageFrom: (p: { from: number }) => string;
    ageTo: (p: { to: number }) => string;
  },
): string | null {
  if (from !== null && to !== null) return t.ageRange({ from, to });
  if (from !== null) return t.ageFrom({ from });
  if (to !== null) return t.ageTo({ to });
  return null;
}

/**
 * Client Component — чтобы можно было инжектить в Quick View dialog
 * (и он по-прежнему корректно SSR'ится в продуктовой странице под
 * `NextIntlClientProvider`).
 */
export function AttributesTable({
  product,
  locale,
  attributeConfigs,
  variant = "default",
}: AttributesTableProps): JSX.Element | null {
  const t = useTranslations("product.attributes");

  const rows: Row[] = [];

  rows.push({
    key: "category",
    label: t("category"),
    value: localized(product.category, "name", locale),
  });

  if (product.brand) {
    rows.push({ key: "brand", label: t("brand"), value: product.brand.name });
  }

  const age = formatAge(product.ageFromMonths, product.ageToMonths, {
    ageRange: (p) => t("ageRange", p),
    ageFrom: (p) => t("ageFrom", p),
    ageTo: (p) => t("ageTo", p),
  });
  if (age !== null) rows.push({ key: "age", label: t("age"), value: age });

  if (product.gender !== "unisex") {
    rows.push({
      key: "gender",
      label: t("gender"),
      value: t(`genderValues.${product.gender}`),
    });
  }

  // Агрегируем атрибуты вариантов: уникальные цвета / размеры / вес.
  //
  // Дубликат "Цвет"-строки: пропускаем aggregation если у товара уже задан
  // `attributes.color` — он рендерится ниже как row со swatch'ом из category-
  // attribute config'а. После рефактора color хранится как ARRAY (multiselect),
  // но legacy-данные могут быть string'ом — учитываем оба shape'а.
  // Fallback для категорий без color-атрибута: agg-row остаётся, чтобы инфо
  // не терялось.
  const colorRaw = product.attributes?.["color"];
  const hasColorAttribute =
    attributeConfigs.some((c) => c.key === "color") &&
    ((typeof colorRaw === "string" && colorRaw.length > 0) ||
      (Array.isArray(colorRaw) && colorRaw.length > 0));
  const colors = Array.from(
    new Set(product.variants.map((v) => v.color).filter((x): x is string => Boolean(x))),
  );
  if (colors.length > 0 && !hasColorAttribute)
    rows.push({ key: "vcolor", label: t("color"), value: colors.join(", ") });

  const sizes = Array.from(
    new Set(product.variants.map((v) => v.size).filter((x): x is string => Boolean(x))),
  );
  if (sizes.length > 0) rows.push({ key: "vsize", label: t("size"), value: sizes.join(", ") });

  const weights = Array.from(
    new Set(product.variants.map((v) => v.weightGrams).filter((x): x is number => x !== null)),
  );
  if (weights.length > 0) {
    rows.push({
      key: "vweight",
      label: t("weight"),
      value: weights.map((g) => t("weightGrams", { grams: g })).join(", "),
    });
  }

  // Category-specific атрибуты из `Product.attributes` (JSON).
  // Рендерим в порядке config'а категории — чтобы UI был предсказуем.
  if (product.attributes) {
    for (const field of attributeConfigs) {
      const raw = product.attributes[field.key];
      if (raw === undefined || raw === null || raw === "") continue;
      const label = pickLabel(field, locale);
      let value: React.ReactNode;
      if (field.kind === "enum") {
        const opt = field.options.find((o) => o.value === String(raw));
        if (!opt) {
          value = String(raw);
        } else if (opt.color) {
          value = (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                title={opt.color}
                className="inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-border"
                style={{ backgroundColor: opt.color }}
              />
              {pickOptionLabel(opt, locale)}
            </span>
          );
        } else {
          value = pickOptionLabel(opt, locale);
        }
      } else if (field.kind === "multiselect") {
        if (!Array.isArray(raw) || raw.length === 0) continue;
        const opts = raw
          .map((v) => field.options.find((o) => o.value === String(v)))
          .filter((o): o is NonNullable<typeof o> => Boolean(o));
        if (opts.length === 0) continue;
        // Если все имеют color — рендерим swatch row. Иначе текстом.
        if (opts.every((o) => o.color)) {
          value = (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {opts.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                    style={{ backgroundColor: o.color }}
                  />
                  {pickOptionLabel(o, locale)}
                </span>
              ))}
            </span>
          );
        } else {
          value = opts.map((o) => pickOptionLabel(o, locale)).join(", ");
        }
      } else if (field.kind === "boolean") {
        if (raw !== true) continue;
        value = "✓";
      } else if (field.kind === "range") {
        const unit = pickUnit(field, locale);
        value = unit ? `${String(raw)} ${unit}` : String(raw);
      } else {
        if (typeof raw !== "string" || raw.length === 0) continue;
        value = raw;
      }
      rows.push({ key: `attr-${field.key}`, label, value });
    }
  }

  if (rows.length === 0) return null;

  const isCompact = variant === "compact";

  return (
    <section className={isCompact ? "mt-2" : "mt-10"}>
      <h2 className={cn("font-semibold", isCompact ? "mb-2 text-sm" : "mb-4 text-xl")}>
        {t("title")}
      </h2>
      <dl className={cn("divide-y rounded-lg border bg-card", isCompact && "text-sm")}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "grid grid-cols-1 gap-1",
              isCompact ? "p-2 sm:grid-cols-[120px_1fr]" : "p-4 sm:grid-cols-[200px_1fr]",
            )}
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-sm font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
