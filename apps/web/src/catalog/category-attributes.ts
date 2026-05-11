/**
 * Pure types + helpers для category-specific атрибутов. Источник данных —
 * `CategoryAttribute` Prisma-модель (P6-T3 follow-up "professional"). Этот
 * модуль:
 *  - не делает DB-fetch'и (для server fetcher'а — `@/server/category-attributes`);
 *  - не зависит от next-intl (per-locale label выбираем через `pickLabel`);
 *  - содержит pure-валидацию `validateAttributes(config, raw)` — тестируется
 *    без БД и без React.
 *
 * Старый hardcoded-конфиг (CATEGORY_ATTRIBUTES + ALL_ATTRIBUTE_KEYS +
 * `attributesForCategory(slug)`) удалён — данные перенесены в БД через
 * seed (см. `packages/db/prisma/seed.ts`). UI-компоненты и server-helpers
 * теперь принимают `CategoryAttributeConfig[]` как proper-driven prop.
 *
 * Filter URL по-прежнему: `?attr.<key>=<val>` для enum/bool/text,
 * `?attr.<key>.min=X&attr.<key>.max=Y` для range, `?attr.<key>=a&attr.<key>=b`
 * для multiselect (повторяющиеся params).
 */

import type { Locale } from "@bigmax/shared-types";

export type AttributeValue = string | number | boolean | string[];

/** Валидные `kind`-дискриминаторы. Соответствует столбцу `category_attributes.kind`. */
export const ATTRIBUTE_KINDS = ["enum", "range", "boolean", "text", "multiselect"] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export interface AttributeOption {
  value: string;
  labelRu: string;
  labelUz: string;
  labelEn: string;
  /** Optional hex color for visual rendering (e.g. "#ef4444"). When set, the
   *  filter UI рендерит swatch вместо dropdown-row, и в attribute-table
   *  показывается dot перед label'ом. Используется для color/material/season-
   *  атрибутов с осмысленным цветом. Формат: `#rgb` или `#rrggbb`. */
  color?: string;
}

/** True if option has a hex color set. */
export function hasOptionColor(o: AttributeOption): o is AttributeOption & { color: string } {
  return typeof o.color === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.color);
}

/** True if EVERY option of an enum/multiselect field has a color → admin
 *  configured this attribute as a "color picker"; UI should render swatches. */
export function isColorField(field: CategoryAttributeConfig): boolean {
  if (field.kind !== "enum" && field.kind !== "multiselect") return false;
  return field.options.length > 0 && field.options.every(hasOptionColor);
}

/** Resolves a variant.color string to its full option (locale-aware label
 *  + hex). Returns `null` если canonical option не найден. */
export function resolveColorOption(
  name: string | null | undefined,
  options: readonly AttributeOption[],
): AttributeOption | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (needle === "") return null;
  for (const o of options) {
    if (o.value.toLowerCase() === needle) return o;
  }
  for (const o of options) {
    if (
      o.labelRu.toLowerCase() === needle ||
      o.labelUz.toLowerCase() === needle ||
      o.labelEn.toLowerCase() === needle
    ) {
      return o;
    }
  }
  return null;
}

/** Извлекает массив color-options из первой `enum`/`multiselect`-attribute,
 *  у которой все опции имеют hex. Возвращает [] если такой нет. */
export function extractColorOptions(
  configs: readonly CategoryAttributeConfig[],
): readonly AttributeOption[] {
  for (const c of configs) {
    if ((c.kind === "enum" || c.kind === "multiselect") && isColorField(c)) {
      return c.options;
    }
  }
  return [];
}

interface BaseConfig {
  id: string;
  categoryId: string;
  key: string;
  labelRu: string;
  labelUz: string;
  labelEn: string;
  helpTextRu: string | null;
  helpTextUz: string | null;
  helpTextEn: string | null;
  isRequired: boolean;
  isFilterable: boolean;
  order: number;
}

export interface EnumConfig extends BaseConfig {
  kind: "enum";
  options: readonly AttributeOption[];
}

export interface MultiselectConfig extends BaseConfig {
  kind: "multiselect";
  options: readonly AttributeOption[];
}

export interface RangeConfig extends BaseConfig {
  kind: "range";
  min: number | null;
  max: number | null;
  step: number | null;
  unitRu: string | null;
  unitUz: string | null;
  unitEn: string | null;
}

export interface BooleanConfig extends BaseConfig {
  kind: "boolean";
}

export interface TextConfig extends BaseConfig {
  kind: "text";
}

export type CategoryAttributeConfig =
  | EnumConfig
  | MultiselectConfig
  | RangeConfig
  | BooleanConfig
  | TextConfig;

// ---------------------------------------------------------------------------
// Locale-aware accessors
// ---------------------------------------------------------------------------

/** Per-locale label с fallback на ru. */
export function pickLabel(field: BaseConfig, locale: Locale): string {
  if (locale === "uz" && field.labelUz) return field.labelUz;
  if (locale === "en" && field.labelEn) return field.labelEn;
  return field.labelRu;
}

export function pickHelpText(field: BaseConfig, locale: Locale): string | null {
  if (locale === "uz" && field.helpTextUz) return field.helpTextUz;
  if (locale === "en" && field.helpTextEn) return field.helpTextEn;
  return field.helpTextRu;
}

export function pickOptionLabel(option: AttributeOption, locale: Locale): string {
  if (locale === "uz" && option.labelUz) return option.labelUz;
  if (locale === "en" && option.labelEn) return option.labelEn;
  return option.labelRu;
}

export function pickUnit(field: RangeConfig, locale: Locale): string | null {
  if (locale === "uz" && field.unitUz) return field.unitUz;
  if (locale === "en" && field.unitEn) return field.unitEn;
  return field.unitRu;
}

// ---------------------------------------------------------------------------
// Pure validator
// ---------------------------------------------------------------------------

export type AttributeValidationResult =
  | { ok: true; sanitized: Record<string, AttributeValue> | null }
  | {
      ok: false;
      key: string;
      reason:
        | "type_mismatch"
        | "enum_value_invalid"
        | "range_negative"
        | "range_below_min"
        | "range_above_max"
        | "required_missing";
    };

/**
 * Валидирует `raw` против category-config'а. Pure-функция (testable без БД).
 *
 * Правила:
 *  - Unknown keys → silent ignore (admin мог сменить категорию).
 *  - Required + value missing/empty → required_missing.
 *  - Type mismatch / enum invalid / range out-of-bounds → discriminated error.
 */
export function validateAttributes(
  config: readonly CategoryAttributeConfig[],
  raw: Record<string, AttributeValue> | null | undefined,
): AttributeValidationResult {
  if (config.length === 0) return { ok: true, sanitized: null };
  const out: Record<string, AttributeValue> = {};
  const input = raw ?? {};

  for (const field of config) {
    const v = input[field.key];
    const isMissing =
      v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

    if (isMissing) {
      if (field.isRequired) {
        return { ok: false, key: field.key, reason: "required_missing" };
      }
      continue;
    }

    if (field.kind === "enum") {
      if (typeof v !== "string") {
        return { ok: false, key: field.key, reason: "type_mismatch" };
      }
      if (!field.options.some((o) => o.value === v)) {
        return { ok: false, key: field.key, reason: "enum_value_invalid" };
      }
      out[field.key] = v;
    } else if (field.kind === "multiselect") {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        return { ok: false, key: field.key, reason: "type_mismatch" };
      }
      const allowed = new Set(field.options.map((o) => o.value));
      if (!v.every((x) => allowed.has(x))) {
        return { ok: false, key: field.key, reason: "enum_value_invalid" };
      }
      out[field.key] = Array.from(new Set(v));
    } else if (field.kind === "boolean") {
      if (typeof v !== "boolean") {
        return { ok: false, key: field.key, reason: "type_mismatch" };
      }
      out[field.key] = v;
    } else if (field.kind === "range") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return { ok: false, key: field.key, reason: "type_mismatch" };
      }
      if (v < 0) return { ok: false, key: field.key, reason: "range_negative" };
      if (field.min !== null && v < field.min) {
        return { ok: false, key: field.key, reason: "range_below_min" };
      }
      if (field.max !== null && v > field.max) {
        return { ok: false, key: field.key, reason: "range_above_max" };
      }
      out[field.key] = v;
    } else {
      // text
      if (typeof v !== "string") {
        return { ok: false, key: field.key, reason: "type_mismatch" };
      }
      const trimmed = v.trim().slice(0, 500);
      if (trimmed.length > 0) out[field.key] = trimmed;
    }
  }

  return { ok: true, sanitized: Object.keys(out).length > 0 ? out : null };
}
