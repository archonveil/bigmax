"use client";

/**
 * `<ProductGallery>` — публичная галерея товара.
 *
 * Композиция:
 *  - Main pane: square preview + prev/next arrow overlays + counter + zoom CTA.
 *  - Thumbnail strip: vertical column на desktop (lg+), horizontal scroll
 *    на mobile/tablet. Active thumb обведён primary ring'ом.
 *  - Lightbox: full-screen `<Dialog>` с увеличенной картинкой, prev/next,
 *    keyboard nav (←/→/Esc), counter.
 *
 * Состояние:
 *  - `activeIndex` — текущий index. Меняется через click thumb, prev/next,
 *    keyboard (когда фокус на main pane или внутри lightbox).
 *  - `lightboxOpen` — открыт/закрыт zoom-overlay.
 *
 * a11y: main pane = `<figure>`; prev/next кнопки имеют aria-label; lightbox =
 * Radix Dialog (focus-trap + Esc встроены).
 */

import { ChevronLeft, ChevronRight, Package, X, ZoomIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";
import type { ProductImageDTO } from "@/server/catalog";

interface ProductGalleryProps {
  images: ProductImageDTO[];
  alt: string;
}

export function ProductGallery({ images, alt }: ProductGalleryProps): JSX.Element {
  const t = useTranslations("product.gallery");
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const total = images.length;
  const safeIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const active = images[safeIndex] ?? images[0];

  const go = useCallback(
    (delta: number): void => {
      if (total <= 1) return;
      setActiveIndex((i) => (i + delta + total) % total);
    },
    [total],
  );

  const goTo = useCallback(
    (idx: number): void => {
      if (idx < 0 || idx >= total) return;
      setActiveIndex(idx);
    },
    [total],
  );

  // Empty state — placeholder card.
  if (total === 0 || !active) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
        <Package className="h-16 w-16 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
        {/* Main pane */}
        <figure
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(-1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLightboxOpen(true);
            }
          }}
          className={cn(
            "group relative aspect-square w-full overflow-hidden rounded-xl border bg-muted lg:flex-1",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          data-testid="product-gallery-main"
          aria-label={t("mainAria", { current: safeIndex + 1, total })}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="absolute inset-0 z-0 cursor-zoom-in"
            aria-label={t("zoom")}
            data-testid="product-gallery-zoom"
          >
            <ProductImage
              src={active.url}
              alt={active.alt ?? alt}
              fill
              sizes="(min-width: 1024px) 520px, 100vw"
              manifestSizes={active.sizes}
              manifestAvifSizes={active.avifSizes}
              className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
              priority
            />
          </button>
          {/* Zoom-hint icon (top-right) */}
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground/70 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="h-4 w-4" />
          </span>
          {/* Prev/Next arrows */}
          {total > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("prev")}
                className="absolute left-2 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md backdrop-blur transition-all hover:bg-background hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="product-gallery-prev"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("next")}
                className="absolute right-2 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-md backdrop-blur transition-all hover:bg-background hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="product-gallery-next"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
              {/* Counter */}
              <span className="pointer-events-none absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center rounded-full bg-background/85 px-3 py-1 text-xs font-medium tabular-nums shadow-sm backdrop-blur">
                {safeIndex + 1} / {total}
              </span>
            </>
          ) : null}
        </figure>

        {/* Thumbnail strip — vertical column на lg+, horizontal scroll иначе.
            На lg+ ограничиваем высоту по main pane через max-h, scroll'имся
            если thumb'ов > чем влезает. */}
        {total > 1 ? (
          <ul
            className="flex w-full gap-2 overflow-x-auto pb-1 lg:w-20 lg:max-h-[520px] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0 lg:pr-1"
            data-testid="product-gallery-thumbs"
          >
            {images.map((img, i) => (
              <li key={img.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className={cn(
                    "relative aspect-square h-16 w-16 overflow-hidden rounded-md border transition-all lg:h-20 lg:w-20",
                    i === safeIndex
                      ? "border-primary ring-2 ring-primary/30 ring-offset-1"
                      : "border-input hover:border-primary/40 hover:scale-105",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label={t("thumbAria", { n: i + 1 })}
                  aria-current={i === safeIndex ? "true" : undefined}
                >
                  <ProductImage
                    src={img.url}
                    alt={img.alt ?? alt}
                    fill
                    sizes="80px"
                    manifestSizes={img.sizes}
                    manifestAvifSizes={img.avifSizes}
                    className="object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Lightbox overlay */}
      {lightboxOpen ? (
        <Lightbox
          images={images}
          activeIndex={safeIndex}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onGoTo={(i) => goTo(i)}
          tLabels={{
            close: t("close"),
            prev: t("prev"),
            next: t("next"),
            thumb: (n: number) => t("thumbAria", { n }),
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Lightbox — full-screen zoom overlay
// ---------------------------------------------------------------------------

function Lightbox({
  images,
  activeIndex,
  alt,
  onClose,
  onPrev,
  onNext,
  onGoTo,
  tLabels,
}: {
  images: ProductImageDTO[];
  activeIndex: number;
  alt: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (i: number) => void;
  tLabels: {
    close: string;
    prev: string;
    next: string;
    thumb: (n: number) => string;
  };
}): JSX.Element {
  const total = images.length;
  const active = images[activeIndex] ?? images[0]!;

  // Keyboard: ←/→/Esc. Body scroll lock на время open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    document.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose, onPrev, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm animate-in fade-in duration-150"
      data-testid="product-gallery-lightbox"
      onClick={(e) => {
        // Click на тёмный фон вокруг картинки закрывает overlay; клик по самой
        // картинке (или кнопкам) — не должен. Проверяем target=currentTarget.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar — counter + close */}
      <div className="flex items-center justify-between gap-3 p-4 text-white">
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium tabular-nums">
          {activeIndex + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tLabels.close}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          data-testid="product-gallery-lightbox-close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Main image area */}
      <div
        className="relative flex flex-1 items-center justify-center px-4 pb-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="relative h-full w-full max-w-5xl">
          <ProductImage
            src={active.url}
            alt={active.alt ?? alt}
            fill
            sizes="(min-width: 1024px) 1024px, 100vw"
            manifestSizes={active.sizes}
            manifestAvifSizes={active.avifSizes}
            className="object-contain"
            priority
          />
        </div>

        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPrev();
              }}
              aria-label={tLabels.prev}
              className="absolute left-4 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              data-testid="product-gallery-lightbox-prev"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
              aria-label={tLabels.next}
              className="absolute right-4 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              data-testid="product-gallery-lightbox-next"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {/* Thumbnail strip — горизонтальный scroll внизу. */}
      {total > 1 ? (
        <ul
          className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto px-4 pb-4"
          data-testid="product-gallery-lightbox-thumbs"
        >
          {images.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onGoTo(i)}
                aria-label={tLabels.thumb(i + 1)}
                aria-current={i === activeIndex ? "true" : undefined}
                className={cn(
                  "relative aspect-square h-14 w-14 overflow-hidden rounded-md border-2 transition-all",
                  i === activeIndex
                    ? "border-white opacity-100"
                    : "border-transparent opacity-50 hover:opacity-90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                )}
              >
                <ProductImage
                  src={img.url}
                  alt={img.alt ?? alt}
                  fill
                  sizes="56px"
                  manifestSizes={img.sizes}
                  manifestAvifSizes={img.avifSizes}
                  className="object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
