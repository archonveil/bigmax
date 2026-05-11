/**
 * Admin CRUD для `CategoryAttribute` (P6-T3 follow-up "professional").
 *
 * Pure-валидаторы (Zod schemas) + Prisma-fetchers/mutations отделены от
 * API routes. Routes импортируют схемы и делегируют I/O сюда; SSR-pages
 * напрямую используют fetcher'ы. Cache-invalidation — на mutation,
 * через `invalidateCategoryAttributesCache()` из `@/server/category-attributes`.
 */

import { Prisma, prisma } from "@bigmax/db";
import { z } from "zod";

import { ATTRIBUTE_KINDS, type AttributeKind } from "@/catalog/category-attributes";
import { invalidateCategoryAttributesCache } from "@/server/category-attributes";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** key: lower-case [a-z0-9_], 1..32 chars. */
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

const KindEnum = z.enum(ATTRIBUTE_KINDS as readonly [AttributeKind, ...AttributeKind[]]);

const OptionSchema = z
  .object({
    value: z
      .string()
      .trim()
      .min(1, "option_value_required")
      .max(64, "option_value_too_long")
      .regex(/^[a-z0-9_-]+$/, "option_value_invalid"),
    labelRu: z.string().trim().min(1, "option_label_required").max(80),
    // RU обязателен; UZ/EN опциональны и при пустом дефолтятся на "".
    labelUz: z.string().trim().max(80, "option_label_too_long").optional().default(""),
    labelEn: z.string().trim().max(80, "option_label_too_long").optional().default(""),
    /** Optional hex color (`#rgb` or `#rrggbb`). Если задан — UI рендерит
     *  swatch для этой опции. Pass-through через JSON column. */
    color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "option_color_invalid")
      .optional(),
  })
  .strict();

const BaseFields = {
  key: z
    .string()
    .trim()
    .min(1, "key_required")
    .max(32, "key_too_long")
    .regex(KEY_RE, "key_invalid"),
  kind: KindEnum,
  labelRu: z.string().trim().min(1, "label_required").max(80),
  labelUz: z.string().trim().max(80, "label_too_long").optional(),
  labelEn: z.string().trim().max(80, "label_too_long").optional(),
  helpTextRu: z.string().trim().max(400).nullable().optional(),
  helpTextUz: z.string().trim().max(400).nullable().optional(),
  helpTextEn: z.string().trim().max(400).nullable().optional(),
  isRequired: z.boolean().optional().default(false),
  isFilterable: z.boolean().optional().default(true),
  order: z.number().int().min(0).max(1000).optional().default(0),
  options: z.array(OptionSchema).max(50).nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  step: z.number().positive().nullable().optional(),
  unitRu: z.string().trim().max(20).nullable().optional(),
  unitUz: z.string().trim().max(20).nullable().optional(),
  unitEn: z.string().trim().max(20).nullable().optional(),
};

/**
 * Refinement: если kind=enum/multiselect → options обязателен (>=1);
 * если kind=range → min/max могут быть null, но если оба заданы — min<=max.
 */
function refineKindRules<T extends z.ZodObject<z.ZodRawShape>>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((data, ctx) => {
    const v = data as unknown as Partial<{
      kind: AttributeKind;
      options: Array<unknown> | null;
      min: number | null;
      max: number | null;
    }>;
    if (v.kind === "enum" || v.kind === "multiselect") {
      if (!v.options || v.options.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "options_required",
        });
      } else if (v.options.length > 50) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "options_too_many",
        });
      }
    }
    if (
      v.kind === "range" &&
      v.min !== null &&
      v.min !== undefined &&
      v.max !== null &&
      v.max !== undefined &&
      v.min > v.max
    ) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "range_invalid" });
    }
  });
}

export const CategoryAttributeCreateSchema = refineKindRules(z.object(BaseFields).strict());
export type CategoryAttributeCreate = z.infer<typeof CategoryAttributeCreateSchema>;

/** Update: все поля optional, но `kind` нельзя менять (data corruption). */
const UpdateFields = {
  labelRu: BaseFields.labelRu.optional(),
  labelUz: BaseFields.labelUz.optional(),
  labelEn: BaseFields.labelEn.optional(),
  helpTextRu: BaseFields.helpTextRu,
  helpTextUz: BaseFields.helpTextUz,
  helpTextEn: BaseFields.helpTextEn,
  isRequired: BaseFields.isRequired,
  isFilterable: BaseFields.isFilterable,
  order: BaseFields.order,
  options: BaseFields.options,
  min: BaseFields.min,
  max: BaseFields.max,
  step: BaseFields.step,
  unitRu: BaseFields.unitRu,
  unitUz: BaseFields.unitUz,
  unitEn: BaseFields.unitEn,
};
export const CategoryAttributeUpdateSchema = z.object(UpdateFields).strict();
export type CategoryAttributeUpdate = z.infer<typeof CategoryAttributeUpdateSchema>;

export const CategoryAttributeReorderSchema = z
  .object({
    orderedIds: z.array(z.string().min(1)).min(1).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// Fetchers (admin-only — без cache, всегда свежее)
// ---------------------------------------------------------------------------

export interface AdminCategoryAttributeRow {
  id: string;
  categoryId: string;
  key: string;
  kind: AttributeKind;
  labelRu: string;
  labelUz: string;
  labelEn: string;
  helpTextRu: string | null;
  helpTextUz: string | null;
  helpTextEn: string | null;
  options: Array<{
    value: string;
    labelRu: string;
    labelUz: string;
    labelEn: string;
    color?: string;
  }> | null;
  min: number | null;
  max: number | null;
  step: number | null;
  unitRu: string | null;
  unitUz: string | null;
  unitEn: string | null;
  isRequired: boolean;
  isFilterable: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

function toAdminRow(
  r: Prisma.CategoryAttributeGetPayload<Record<string, never>>,
): AdminCategoryAttributeRow {
  let options: AdminCategoryAttributeRow["options"] = null;
  if (Array.isArray(r.options)) {
    const arr: NonNullable<AdminCategoryAttributeRow["options"]> = [];
    for (const o of r.options) {
      if (
        o &&
        typeof o === "object" &&
        !Array.isArray(o) &&
        typeof (o as Record<string, unknown>)["value"] === "string"
      ) {
        const x = o as Record<string, string>;
        const item: NonNullable<AdminCategoryAttributeRow["options"]>[number] = {
          value: x["value"]!,
          labelRu: x["labelRu"] ?? "",
          labelUz: x["labelUz"] ?? "",
          labelEn: x["labelEn"] ?? "",
        };
        if (
          typeof x["color"] === "string" &&
          /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(x["color"])
        ) {
          item.color = x["color"];
        }
        arr.push(item);
      }
    }
    options = arr;
  }
  return {
    id: r.id,
    categoryId: r.categoryId,
    key: r.key,
    kind: r.kind as AttributeKind,
    labelRu: r.labelRu,
    labelUz: r.labelUz,
    labelEn: r.labelEn,
    helpTextRu: r.helpTextRu,
    helpTextUz: r.helpTextUz,
    helpTextEn: r.helpTextEn,
    options,
    min: r.min,
    max: r.max,
    step: r.step,
    unitRu: r.unitRu,
    unitUz: r.unitUz,
    unitEn: r.unitEn,
    isRequired: r.isRequired,
    isFilterable: r.isFilterable,
    order: r.order,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getAdminCategoryAttributes(
  categoryId: string,
): Promise<AdminCategoryAttributeRow[]> {
  const rows = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toAdminRow);
}

export async function getAdminCategoryAttribute(
  id: string,
): Promise<AdminCategoryAttributeRow | null> {
  const r = await prisma.categoryAttribute.findUnique({ where: { id } });
  return r ? toAdminRow(r) : null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface KindSpecificWrite {
  options: Prisma.InputJsonValue | typeof Prisma.DbNull;
  min: number | null;
  max: number | null;
  step: number | null;
  unitRu: string | null;
  unitUz: string | null;
  unitEn: string | null;
}

/** Чистит kind-несовместимые поля (например, `min` для kind=enum). */
function buildKindSpecific(
  input: CategoryAttributeCreate | CategoryAttributeUpdate,
  kindHint: AttributeKind,
): KindSpecificWrite {
  if (kindHint === "enum" || kindHint === "multiselect") {
    return {
      options:
        input.options === null || input.options === undefined
          ? Prisma.DbNull
          : (input.options as unknown as Prisma.InputJsonValue),
      min: null,
      max: null,
      step: null,
      unitRu: null,
      unitUz: null,
      unitEn: null,
    };
  }
  if (kindHint === "range") {
    return {
      options: Prisma.DbNull,
      min: input.min ?? null,
      max: input.max ?? null,
      step: input.step ?? null,
      unitRu: input.unitRu ?? null,
      unitUz: input.unitUz ?? null,
      unitEn: input.unitEn ?? null,
    };
  }
  // boolean / text — нет kind-specific'ов.
  return {
    options: Prisma.DbNull,
    min: null,
    max: null,
    step: null,
    unitRu: null,
    unitUz: null,
    unitEn: null,
  };
}

export async function createCategoryAttribute(
  categoryId: string,
  input: CategoryAttributeCreate,
): Promise<{ ok: true; id: string } | { ok: false; reason: "key_exists" | "category_not_found" }> {
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!cat) return { ok: false, reason: "category_not_found" };

  const kindSpecific = buildKindSpecific(input, input.kind);
  try {
    const created = await prisma.categoryAttribute.create({
      data: {
        categoryId,
        key: input.key,
        kind: input.kind,
        labelRu: input.labelRu,
        labelUz: input.labelUz ?? "",
        labelEn: input.labelEn ?? "",
        helpTextRu: input.helpTextRu ?? null,
        helpTextUz: input.helpTextUz ?? null,
        helpTextEn: input.helpTextEn ?? null,
        isRequired: input.isRequired,
        isFilterable: input.isFilterable,
        order: input.order,
        ...kindSpecific,
      },
      select: { id: true },
    });
    invalidateCategoryAttributesCache();
    return { ok: true, id: created.id };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { code: string }).code === "string" &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, reason: "key_exists" };
    }
    throw err;
  }
}

export async function updateCategoryAttribute(
  id: string,
  input: CategoryAttributeUpdate,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const existing = await prisma.categoryAttribute.findUnique({
    where: { id },
    select: { kind: true },
  });
  if (!existing) return { ok: false, reason: "not_found" };

  const kindSpecific = buildKindSpecific(input, existing.kind as AttributeKind);
  const data: Prisma.CategoryAttributeUncheckedUpdateInput = { ...kindSpecific };
  if (input.labelRu !== undefined) data.labelRu = input.labelRu;
  if (input.labelUz !== undefined) data.labelUz = input.labelUz;
  if (input.labelEn !== undefined) data.labelEn = input.labelEn;
  if (input.helpTextRu !== undefined) data.helpTextRu = input.helpTextRu;
  if (input.helpTextUz !== undefined) data.helpTextUz = input.helpTextUz;
  if (input.helpTextEn !== undefined) data.helpTextEn = input.helpTextEn;
  if (input.isRequired !== undefined) data.isRequired = input.isRequired;
  if (input.isFilterable !== undefined) data.isFilterable = input.isFilterable;
  if (input.order !== undefined) data.order = input.order;

  await prisma.categoryAttribute.update({ where: { id }, data });
  invalidateCategoryAttributesCache();
  return { ok: true };
}

export async function deleteCategoryAttribute(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const existing = await prisma.categoryAttribute.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: "not_found" };
  await prisma.categoryAttribute.delete({ where: { id } });
  invalidateCategoryAttributesCache();
  return { ok: true };
}

/**
 * Bulk-reorder attributes одной категории. Принимает массив id'ов в нужном
 * порядке; назначает `order` = index. Атомарно через $transaction.
 */
export async function reorderCategoryAttributes(
  categoryId: string,
  orderedIds: string[],
): Promise<{ ok: true; updated: number } | { ok: false; reason: "mismatch" }> {
  // Проверяем, что все id'ы принадлежат этой категории.
  const existing = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    return { ok: false, reason: "mismatch" };
  }
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.categoryAttribute.update({ where: { id }, data: { order: idx + 1 } }),
    ),
  );
  invalidateCategoryAttributesCache();
  return { ok: true, updated: orderedIds.length };
}
