"use client";

/**
 * `<ProductCardMedia>` — кликабельная картинка + интерактивный swatch-ряд
 * на катaloге-карточке (`<ProductCard>`).
 *
 * UX: hover/focus swatch'а → image переключается на картинку именно этого
 * варианта (если у него есть own image). Mouse-leave / blur → возвращаемся
 * к default'у. На touch'е tap-swatch toggle'ит: первый tap — image swap,
 * второй tap по тому же swatch — снимает hover-state.
 *
 * Anchor (`<Link>`) для перехода на страницу товара остаётся вокруг ВСЕЙ
 * картинки — клик по фотке открывает product page. Swatch'и — отдельные
 * buttons НАД anchor'ом, `stopPropagation` чтобы клик не «прокликивал»
 * картинку.
 *
 * a11y: swatch — `<button>` с `aria-label` (имя цвета); `data-active` для CSS
 * state'а; keyboard-focus вызывает то же image-swap что hover.
 */

import { Link } from "@bigmax/i18n/navigation";
import type { Locale } from "@bigmax/shared-types";
import { useState } from "react";

import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";
import type { ProductCardDTO, ProductCardVariant } from "@/server/catalog";

interface Props {
  slug: string;
  alt: string;
  defaultImageUrl: string | null;
  /** WebP multi-size variants для default image. */
  defaultImageSizes?: Record<string, string> | null;
  /** AVIF multi-size variants для default image. */
  defaultImageAvifSizes?: Record<string, string> | null;
  variants: ProductCardVariant[];
  colorOptions: readonly AttributeOption[];
  locale: Locale;
  /** Максимум swatch'ей в ряду — остаток показываем как `+N`. */
  maxDots?: number;
  /** Overlay-узлы (QuickView, FavoriteButton) — рендерятся поверх картинки. */
  children?: React.ReactNode;
}

const DEFAULT_MAX = 5;

interface ColorEntry {
  /** Hex для swatch'а. */
  hex: string;
  /** Локализованное название цвета — для aria-label / title. */
  name: string;
  /** Картинка варианта этого цвета (если есть). */
  imageUrl: string | null;
  /** WebP multi-size variants для srcset при swatch-hover swap. */
  imageSizes: Record<string, string> | null;
  /** AVIF multi-size variants. */
  imageAvifSizes: Record<string, string> | null;
  /** SKU первого варианта этого цвета — для data-атрибута / тестов. */
  sku: string;
}

/** Сводим variants → уникальные цвета с их первой картинкой. */
function collectColorEntries(
  variants: ProductCardVariant[],
  colorOptions: readonly AttributeOption[],
  locale: Locale,
): ColorEntry[] {
  if (colorOptions.length === 0) return [];
  const seen = new Map<string, ColorEntry>();
  for (const v of variants) {
    const opt = resolveColorOption(v.color, colorOptions);
    if (!opt?.color) continue;
    if (seen.has(opt.color)) {
      // Если у первого варианта этого цвета imageUrl был null, а у этого есть —
      // апдейтим entry (так пользователь увидит реальную фотку при hover'е).
      const existing = seen.get(opt.color);
      if (existing && existing.imageUrl === null && v.imageUrl !== null) {
        existing.imageUrl = v.imageUrl;
        existing.imageSizes = v.imageSizes;
        existing.imageAvifSizes = v.imageAvifSizes;
      }
      continue;
    }
    seen.set(opt.color, {
      hex: opt.color,
      name: pickOptionLabel(opt, locale),
      imageUrl: v.imageUrl,
      imageSizes: v.imageSizes,
      imageAvifSizes: v.imageAvifSizes,
      sku: v.sku,
    });
  }
  return Array.from(seen.values());
}

export { collectColorEntries };

export function ProductCardMedia({
  slug,
  alt,
  defaultImageUrl,
  defaultImageSizes = null,
  defaultImageAvifSizes = null,
  variants,
  colorOptions,
  locale,
  maxDots = DEFAULT_MAX,
  children,
}: Props): JSX.Element {
  const entries = collectColorEntries(variants, colorOptions, locale);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);

  const dotsToShow = entries.slice(0, maxDots);
  const overflow = entries.length > maxDots ? entries.length - maxDots : 0;

  // Текущая картинка: если есть hovered color и у него есть imageUrl — берём
  // её (вместе с sizes/avifSizes для srcset/picture); иначе default.
  const activeEntry = hoveredHex !== null ? entries.find((e) => e.hex === hoveredHex) : null;
  const currentImageUrl = activeEntry?.imageUrl ?? defaultImageUrl;
  const currentImageSizes = activeEntry?.imageSizes ?? defaultImageSizes;
  const currentImageAvifSizes = activeEntry?.imageAvifSizes ?? defaultImageAvifSizes;

  return (
    <>
      <div
        className="relative mb-4 aspect-square overflow-hidden rounded-md bg-muted"
        onMouseLeave={() => setHoveredHex(null)}
      >
        <Link
          href={`/product/${slug}` as never}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={alt}
        >
          <ProductImage
            src={currentImageUrl}
            alt={alt}
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            manifestSizes={currentImageSizes}
            manifestAvifSizes={currentImageAvifSizes}
            className="object-cover transition-[transform,opacity] duration-200 group-hover:scale-105"
          />
        </Link>
        {children}
      </div>

      {dotsToShow.length > 0 ? (
        <div
          className="mt-1.5 flex items-center gap-1"
          aria-label={dotsToShow.map((d) => d.name).join(", ")}
          data-testid="product-card-swatches"
        >
          {dotsToShow.map((d) => {
            const active = hoveredHex === d.hex;
            return (
              <button
                key={d.hex}
                type="button"
                title={d.name}
                aria-label={d.name}
                aria-pressed={active}
                onMouseEnter={() => setHoveredHex(d.hex)}
                onFocus={() => setHoveredHex(d.hex)}
                onClick={(e) => {
                  // Click на катaloge — НЕ navigation (anchor выше). Toggle hover-
                  // state'а для touch-юзеров (mouse не нужен).
                  e.preventDefault();
                  e.stopPropagation();
                  setHoveredHex((prev) => (prev === d.hex ? null : d.hex));
                }}
                className={cn(
                  "inline-block h-4 w-4 cursor-pointer rounded-full ring-1 ring-inset ring-border transition-transform",
                  "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                  active && "ring-2 ring-primary",
                )}
                style={{ backgroundColor: d.hex }}
                data-active={active ? "true" : "false"}
                data-sku={d.sku}
              />
            );
          })}
          {overflow > 0 ? (
            <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
              +{overflow}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// Re-export type for external usage if нужно (e.g. в тестах).
export type { Props as ProductCardMediaProps };

// Convenience helper для server-component'ов, который хочет узнать заранее,
// показывать ли swatch-row (чтобы не передавать в client лишние пропы).
export function hasColorSwatches(
  variants: { color: string | null }[],
  colorOptions: readonly AttributeOption[],
): boolean {
  if (colorOptions.length === 0) return false;
  for (const v of variants) {
    const opt = resolveColorOption(v.color, colorOptions);
    if (opt?.color) return true;
  }
  return false;
}

// Catalog ProductCardDTO — нужен ли его re-export?
export type { ProductCardDTO };
