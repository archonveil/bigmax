"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export const PRODUCT_PLACEHOLDER_SRC = "/product-placeholder.svg";

const TRUSTED_OPTIMIZE_HOSTS = ["placehold.co", "res.cloudinary.com"];

/**
 * Trusted-source allow-list для next/image optimization. Всё что НЕ в этом
 * списке (или из local `/uploads/`) — рендерится с `unoptimized: true`:
 * Next отдаёт URL напрямую через `<img>`, без host-validation.
 *
 * Зачем so:
 *  - Admin может вставить URL с любого CDN, но мы не хотим открывать
 *    `/_next/image` как free-resize-service для всего интернета (DoS-vector).
 *  - На уже-processed картинках из `/uploads/` нет смысла гонять второй pass.
 */
function shouldOptimize(src: string): boolean {
  if (src === PRODUCT_PLACEHOLDER_SRC) return false;
  if (src.startsWith("/uploads/")) return false;
  if (src.startsWith("/")) return true;
  try {
    const url = new URL(src);
    return TRUSTED_OPTIMIZE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** Превращает `{ w400: "...", w800: "..." }` в native `srcSet` строку,
 *  отсортированную по ширине ASC. */
function buildSrcSet(sizesMap: Record<string, string>): { srcSet: string; largest: string | null } {
  const entries: Array<[number, string]> = [];
  for (const [key, url] of Object.entries(sizesMap)) {
    const match = /^w(\d+)$/.exec(key);
    if (!match || !match[1]) continue;
    const w = Number.parseInt(match[1], 10);
    if (!Number.isFinite(w) || w <= 0) continue;
    entries.push([w, url]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const srcSet = entries.map(([w, url]) => `${url} ${w}w`).join(", ");
  const largest = entries.length > 0 ? (entries[entries.length - 1]?.[1] ?? null) : null;
  return { srcSet, largest };
}

type ImagePropsBase = Omit<ImageProps, "src">;

interface Props extends ImagePropsBase {
  src: string | null | undefined;
  /** WebP multi-size manifest (`{ w400: ..., w800: ... }`). Если задан —
   *  рендерится native `<img srcset>` (или `<picture>` если есть AVIF),
   *  минуя next/image (closes OPT-021 + Phase 5b). */
  manifestSizes?: Record<string, string> | null;
  /** AVIF multi-size manifest. Когда И WebP, И AVIF доступны — рендерится
   *  `<picture><source type="image/avif"><source type="image/webp"><img></picture>`.
   *  Браузеры с AVIF support'ом (~88%) забирают на 20-25% меньше байт. */
  manifestAvifSizes?: Record<string, string> | null;
}

/**
 * Обёртка над next/image: на `onError` подменяет src на локальный SVG-
 * плейсхолдер.
 *
 * **Phase 5 enhancement:** если передан `manifestSizes` — рендерится native
 * `<img srcset>` напрямую, без next/image. Это экономит CPU `/_next/image`
 * resize-passes (картинки уже WebP-compressed на upload'е).
 *
 * Для не-trusted внешних URL'ов — автоматически `unoptimized: true`, чтобы
 * admin мог вставить URL с любого CDN без правок next.config.mjs.
 */
export function ProductImage({
  src,
  alt,
  manifestSizes,
  manifestAvifSizes,
  fill,
  className,
  priority,
  sizes,
  ...rest
}: Props): JSX.Element {
  const initial = typeof src === "string" && src.length > 0 ? src : PRODUCT_PLACEHOLDER_SRC;
  const [current, setCurrent] = useState(initial);

  useEffect(() => {
    setCurrent(initial);
  }, [initial]);

  const isFallback = current === PRODUCT_PLACEHOLDER_SRC;

  // Multi-size path: native <picture>/<img srcset>. Bypass'ит next/image.
  if (
    !isFallback &&
    manifestSizes &&
    Object.keys(manifestSizes).length > 0 &&
    current === initial
  ) {
    const { srcSet: webpSrcSet, largest: webpLargest } = buildSrcSet(manifestSizes);
    const hasAvif = manifestAvifSizes && Object.keys(manifestAvifSizes).length > 0;
    const avifResult = hasAvif && manifestAvifSizes ? buildSrcSet(manifestAvifSizes) : null;
    const fallbackSrc = webpLargest ?? current;
    const imgClassName = cn(
      // `fill` mode в next/image: position absolute, inset 0, размер 100%.
      // Реплицируем для feature-parity.
      fill && "absolute inset-0 h-full w-full",
      className,
    );
    // Intentional `<img>` (не `<Image>`): pre-processed multi-size manifest
    // даёт нам корректный srcset напрямую. Бессмысленно гонять через
    // /_next/image second-pass — closes OPT-021. Когда AVIF тоже есть —
    // оборачиваем в `<picture>` для format-negotiation'а (Phase 5b).
    const imgEl = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fallbackSrc}
        {...(webpSrcSet ? { srcSet: webpSrcSet } : {})}
        {...(sizes ? { sizes } : {})}
        alt={alt}
        onError={() => setCurrent(PRODUCT_PLACEHOLDER_SRC)}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={imgClassName}
      />
    );
    if (avifResult && avifResult.srcSet) {
      return (
        <picture>
          <source type="image/avif" srcSet={avifResult.srcSet} {...(sizes ? { sizes } : {})} />
          <source type="image/webp" srcSet={webpSrcSet} {...(sizes ? { sizes } : {})} />
          {imgEl}
        </picture>
      );
    }
    return imgEl;
  }

  // Fallback: next/image. Для /uploads/ + external URLs — `unoptimized`.
  return (
    <Image
      {...rest}
      src={current}
      alt={alt}
      {...(sizes !== undefined ? { sizes } : {})}
      {...(fill !== undefined ? { fill } : {})}
      {...(priority !== undefined ? { priority } : {})}
      {...(className !== undefined ? { className } : {})}
      onError={() => {
        if (!isFallback) setCurrent(PRODUCT_PLACEHOLDER_SRC);
      }}
      unoptimized={!shouldOptimize(current)}
    />
  );
}
