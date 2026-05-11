/**
 * Admin Variants — Zod-схемы для CRUD ProductVariant'ов (P6-T3 follow-up).
 *
 * `ProductVariant` хранит SKU/цвет/размер/цену/штрихкод/вес. Owner — Product;
 * cascade-delete от Product. SKU и barcode — `@unique` (один SKU на всю
 * систему, не per-product). Cents-integer строго (§6 правило 8).
 */

import { z } from "zod";

const SKU_RE = /^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?$/;

/**
 * Базовый shape. SKU — UPPERCASE alphanumeric + `_`/`-`, чтобы избежать
 * случайных пробелов / unicode и держать SKU «techy».
 */
const VariantBaseSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2, "sku_too_short")
    .max(64, "sku_too_long")
    .regex(SKU_RE, "sku_invalid"),
  color: z.string().trim().max(64, "color_too_long").optional().nullable(),
  size: z.string().trim().max(32, "size_too_long").optional().nullable(),
  priceCents: z
    .number()
    .int("price_must_be_integer")
    .min(0, "price_negative")
    .max(1_000_000_000, "price_too_high"),
  oldPriceCents: z
    .number()
    .int("old_price_must_be_integer")
    .min(0, "old_price_negative")
    .max(1_000_000_000, "old_price_too_high")
    .optional()
    .nullable(),
  barcode: z.string().trim().max(64, "barcode_too_long").optional().nullable(),
  weightGrams: z
    .number()
    .int("weight_must_be_integer")
    .min(0, "weight_negative")
    .max(100_000, "weight_too_high")
    .optional()
    .nullable(),
  /** Картинки уровня варианта. Replace-set семантика (как у Product.images).
   *  При отсутствии — backend оставляет существующие нетронутыми (PATCH-
   *  semantics: undefined = «не менять»). Передача `[]` → удалить все. */
  images: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        url: z
          .string()
          .trim()
          .min(1, "image_url_required")
          .max(2048, "image_url_too_long")
          .regex(/^(?:https?:\/\/|\/)/i, "image_url_invalid"),
        alt: z.string().max(500).nullable().optional(),
        order: z.number().int().min(0).max(1000).optional(),
        /** WebP multi-size variants (`{ w400: "/uploads/.../w400.webp", ... }`).
         *  Заполняется из upload-response'а. Опционально — внешние CDN URL'ы
         *  не имеют pre-processed вариантов, fallback на single-URL render. */
        sizes: z.record(z.string().min(1).max(2048)).nullable().optional(),
        /** AVIF multi-size variants (Phase 5b): тот же набор breakpoints. */
        avifSizes: z.record(z.string().min(1).max(2048)).nullable().optional(),
      }),
    )
    .max(20, "too_many_variant_images")
    .optional(),
});

/**
 * `oldPriceCents` обычно «зачёркнутая старая цена» — должна быть БОЛЬШЕ
 * текущей `priceCents` (иначе скидка отрицательная и UI её скроет).
 */
const oldPriceRefine = (v: {
  priceCents: number;
  oldPriceCents?: number | null | undefined;
}): boolean => {
  if (v.oldPriceCents === undefined || v.oldPriceCents === null) return true;
  return v.oldPriceCents > v.priceCents;
};

export const VariantCreateSchema = VariantBaseSchema.refine(oldPriceRefine, {
  message: "old_price_must_exceed_price",
  path: ["oldPriceCents"],
});
export type VariantCreate = z.infer<typeof VariantCreateSchema>;

/**
 * PATCH — все поля optional. Refine на oldPrice применяется только если
 * **оба** поля присутствуют в payload'е (partial-update не должен ругаться
 * на отсутствие priceCents).
 */
export const VariantUpdateSchema = VariantBaseSchema.partial().refine(
  (v) => {
    if (v.oldPriceCents === undefined || v.oldPriceCents === null) return true;
    if (v.priceCents === undefined) return true; // PATCH без priceCents — пропускаем
    return v.oldPriceCents > v.priceCents;
  },
  { message: "old_price_must_exceed_price", path: ["oldPriceCents"] },
);
export type VariantUpdate = z.infer<typeof VariantUpdateSchema>;
