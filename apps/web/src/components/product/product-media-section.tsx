"use client";

/**
 * `<ProductMediaSection>` — wrapper над `<ProductGallery>` + `<VariantPicker>`
 * на storefront-product-page'е.
 *
 * **Зачем нужен:** галерея и picker раньше жили siblings'ами в server-page'е,
 * каждый со своим state'ом. Теперь pickerselectedVariantId «подтягивает»
 * галерею — при выборе варианта показываются ЕГО картинки (если есть),
 * fallback на product-level.
 *
 * **Selection ownership:** `<VariantPicker>` остаётся owner'ом selectedId
 * (внутренний `useState`). Этот wrapper слушает через `onSelectedChange`
 * callback и пересчитывает filtered-images.
 *
 * **Filter rule** (`pickImagesForVariant`):
 *   1. Если у выбранного варианта есть свои картинки (`img.variantId === selectedId`)
 *      → показываем ТОЛЬКО их.
 *   2. Иначе → показываем product-level картинки (`img.variantId === null`).
 *
 * Это natural fallback: variant overrides gallery когда он имеет own assets;
 * default-gallery (фото товара в целом) показывается для variant'ов без
 * собственных картинок.
 */

import type { Locale } from "@bigmax/shared-types";
import { useMemo, useState } from "react";

import type { AttributeOption } from "@/catalog/category-attributes";
import { ProductGallery } from "@/components/product/product-gallery";
import { VariantPicker, type VariantPickerProduct } from "@/components/product/variant-picker";
import type { ProductImageDTO, ProductVariantDTO } from "@/server/catalog";

interface Props {
  product: VariantPickerProduct;
  variants: ProductVariantDTO[];
  images: ProductImageDTO[];
  /** Локализованное имя — рендерится как `<h1>` над picker'ом и в alt-fallback'е. */
  name: string;
  locale: Locale;
  colorOptions?: readonly AttributeOption[];
}

/**
 * Pure: выбирает картинки для активного варианта с fallback-цепочкой.
 *
 * Resolve order (от specific к generic):
 *   1. `colorTag === variant.color` — color-group (основной механизм; sibling-
 *      варианты того же цвета используют один и тот же набор).
 *   2. `variantId === variant.id` — per-variant override (редко).
 *   3. `colorTag === null && variantId === null` — product-level shared.
 *   4. Все картинки (legacy fallback на случай неконсистентных данных).
 */
export function pickImagesForVariant(
  images: ProductImageDTO[],
  selectedVariantId: string | undefined,
  variants: ProductVariantDTO[],
): ProductImageDTO[] {
  const selected = variants.find((v) => v.id === selectedVariantId);
  // 1. Color-tag match.
  if (selected?.color) {
    const byColor = images.filter((img) => img.colorTag === selected.color);
    if (byColor.length > 0) return byColor;
  }
  // 2. Per-variant override.
  if (selectedVariantId !== undefined) {
    const byVariant = images.filter((img) => img.variantId === selectedVariantId);
    if (byVariant.length > 0) return byVariant;
  }
  // 3. Product-level shared.
  const productLevel = images.filter((img) => img.variantId === null && img.colorTag === null);
  if (productLevel.length > 0) return productLevel;
  // 4. Legacy fallback — все картинки.
  return images;
}

export function ProductMediaSection({
  product,
  variants,
  images,
  name,
  locale,
  colorOptions = [],
}: Props): JSX.Element {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(variants[0]?.id);

  const galleryImages = useMemo(
    () => pickImagesForVariant(images, selectedVariantId, variants),
    [images, selectedVariantId, variants],
  );

  return (
    <>
      <ProductGallery images={galleryImages} alt={name} />
      <div className="space-y-6">
        {product.brandName ? (
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            {product.brandName}
          </p>
        ) : null}
        <h1 className="text-3xl font-bold">{name}</h1>
        <VariantPicker
          product={product}
          variants={variants}
          locale={locale}
          colorOptions={colorOptions}
          onSelectedChange={setSelectedVariantId}
        />
      </div>
    </>
  );
}
