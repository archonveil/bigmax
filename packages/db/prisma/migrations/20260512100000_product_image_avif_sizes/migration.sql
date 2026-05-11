-- ProductImage.avifSizes — AVIF multi-size variants (Phase 5b).
--
-- AVIF на ~20-25% меньше WebP при том же качестве; ~88% браузеров поддерживают.
-- Storefront рендерит `<picture><source type="image/avif"><source type="image/webp">
-- <img></picture>` — Safari < 16 и старые Edge fallback'ятся на WebP.

ALTER TABLE "product_images" ADD COLUMN "avif_sizes" JSONB;
