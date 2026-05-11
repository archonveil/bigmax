-- ProductImage.sizes — multi-size srcset variants (Phase 5).
--
-- JSON-карта `{ "w400": "/uploads/.../w400.webp", "w800": "...", ... }`,
-- заполняется при upload'е через sharp-pipeline. Если present — `<ProductImage>`
-- рендерит `<img srcset>` напрямую, минуя `/_next/image` (closes OPT-021).
--
-- NULL для legacy-картинок (до миграции) — `<ProductImage>` fallback'ит на
-- single-URL render через next/image с `unoptimized: true` для /uploads/.

ALTER TABLE "product_images" ADD COLUMN "sizes" JSONB;
