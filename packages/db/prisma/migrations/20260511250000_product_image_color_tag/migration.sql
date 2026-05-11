-- ProductImage.colorTag — image-grouping by color.
--
-- Раньше каждая variant-level картинка привязывалась к одному variantId, что
-- приводило к дублированию (3 размера красного варианта = 3 копии одного фото).
-- Новая модель: картинка принадлежит цвету (color-group), все варианты этого
-- цвета её разделяют. `variantId` остаётся для редких per-variant override'ов.
--
-- Backfill: для существующих variant-level картинок копируем variant.color в
-- colorTag и обнуляем variantId — все sibling-варианты того же цвета теперь
-- увидят эту картинку через color-tag lookup.

ALTER TABLE "product_images" ADD COLUMN "color_tag" TEXT;

CREATE INDEX "product_images_product_id_color_tag_idx" ON "product_images"("product_id", "color_tag");

-- Backfill: copy variant.color → colorTag для всех вариант-level картинок.
UPDATE "product_images" AS pi
SET "color_tag" = pv."color"
FROM "product_variants" AS pv
WHERE pi."variant_id" = pv."id"
  AND pi."variant_id" IS NOT NULL
  AND pv."color" IS NOT NULL
  AND pv."color" <> '';

-- После backfill'а variantId больше не нужен для color-tagged картинок —
-- обнуляем чтобы primary lookup шёл через colorTag без двойного matching'а.
-- variantId оставляем только для картинок, у которых variant.color был NULL
-- (т.е. variant различается ТОЛЬКО размером — не общий кейс, но возможно).
UPDATE "product_images"
SET "variant_id" = NULL
WHERE "color_tag" IS NOT NULL;

-- De-duplication: внутри одного (productId, colorTag) могло появиться N копий
-- одного URL (по одной на каждый sibling-вариант). Оставляем самую раннюю
-- (минимальный id) на каждый (productId, colorTag, url).
DELETE FROM "product_images" AS pi
USING "product_images" AS pj
WHERE pi."product_id" = pj."product_id"
  AND pi."color_tag" = pj."color_tag"
  AND pi."color_tag" IS NOT NULL
  AND pi."url" = pj."url"
  AND pi."id" > pj."id";
