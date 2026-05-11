"use client";

/**
 * `<ProductImagesOverview>` — read-only display всех картинок товара,
 * сгруппированных по color-tag'у. Upload-функции нет — картинки добавляются
 * ТОЛЬКО через variant edit dialog (см. `<VariantsManager>`).
 *
 * **Группировка:**
 *   - Color-tagged картинки (`colorTag IS NOT NULL`) — одна group'а на цвет,
 *     заголовок с swatch'ем + локализованным именем цвета. Sibling-варианты
 *     этого цвета РАЗДЕЛЯЮТ этот набор.
 *   - Variant-level overrides (`variantId IS NOT NULL`) — отдельная group'а
 *     «Особые: SKU…» для редких per-variant exception'ов.
 *   - Product-level shared (`colorTag IS NULL AND variantId IS NULL`) — group'а
 *     «Общие» (показывается когда ни color, ни variant-override не подходит).
 *
 * Каждая card получает badge primary (★) для первой картинки global-order.
 */

import type { Locale } from "@bigmax/shared-types";
import { Box, ImagePlus, Palette, Star, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import { Label } from "@/components/ui/label";
import type { AdminProductDetail, AdminVariant } from "@/server/admin-products";

interface Props {
  images: AdminProductDetail["images"];
  variants: AdminVariant[];
  locale: Locale;
  colorOptions?: readonly AttributeOption[];
}

type ImageEntry = AdminProductDetail["images"][number];

interface Group {
  kind: "color" | "variant" | "product";
  /** Локализованный заголовок group'ы. */
  label: string;
  /** Дополнительные строки заголовка (для variant — SKU/size). */
  subLabel?: string;
  /** Swatch hex (только для color-group). */
  swatchHex?: string;
  images: ImageEntry[];
}

export function ProductImagesOverview({
  images,
  variants,
  locale,
  colorOptions = [],
}: Props): JSX.Element {
  const t = useTranslations("admin.products.form.images");

  // Group images by colorTag → "variant override" → product-level.
  const colorGroups = new Map<string, ImageEntry[]>();
  const variantGroups = new Map<string, ImageEntry[]>();
  const productLevel: ImageEntry[] = [];
  for (const img of images) {
    if (img.colorTag !== null) {
      const arr = colorGroups.get(img.colorTag) ?? [];
      arr.push(img);
      colorGroups.set(img.colorTag, arr);
    } else if (img.variantId !== null) {
      const arr = variantGroups.get(img.variantId) ?? [];
      arr.push(img);
      variantGroups.set(img.variantId, arr);
    } else {
      productLevel.push(img);
    }
  }

  const groups: Group[] = [];
  // Color groups first — наиболее частый кейс.
  for (const [color, imgs] of colorGroups.entries()) {
    const opt = resolveColorOption(color, colorOptions);
    const label = opt ? pickOptionLabel(opt, locale) : color;
    const group: Group = {
      kind: "color",
      label,
      images: imgs,
    };
    if (opt?.color) group.swatchHex = opt.color;
    groups.push(group);
  }
  // Variant-override groups.
  for (const [variantId, imgs] of variantGroups.entries()) {
    const v = variants.find((x) => x.id === variantId);
    const variantLabel = v ? [v.color, v.size].filter(Boolean).join(" · ") || v.sku : variantId;
    groups.push({
      kind: "variant",
      label: t("variantOverrideLabel"),
      subLabel: variantLabel,
      images: imgs,
    });
  }
  // Product-level group last.
  if (productLevel.length > 0) {
    groups.push({
      kind: "product",
      label: t("commonBadge"),
      images: productLevel,
    });
  }

  return (
    <section className="space-y-3" data-testid="product-images-overview">
      <header>
        <Label className="text-base font-semibold">{t("title")}</Label>
        <p className="text-xs text-muted-foreground">
          {images.length === 0
            ? t("readOnlyHintEmpty")
            : t("readOnlyHint", { count: images.length })}
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
          <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">{t("readOnlyEmptyState")}</p>
        </div>
      ) : (
        <ul className="space-y-4" data-testid="product-images-overview-groups">
          {groups.map((group, gi) => (
            <li
              key={`${group.kind}-${gi}`}
              className="space-y-2 rounded-lg border bg-card p-3"
              data-testid="product-images-overview-group"
              data-kind={group.kind}
            >
              <GroupHeader group={group} count={group.images.length} t={t} />
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {group.images.map((img, i) => (
                  <li
                    key={img.id}
                    className="group/card relative overflow-hidden rounded-md border bg-muted"
                    data-testid="product-image-overview-card"
                  >
                    <div className="relative aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.alt ?? ""}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                      {gi === 0 && i === 0 ? (
                        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                          <Star className="h-3 w-3 fill-current" aria-hidden />
                          {t("primary")}
                        </span>
                      ) : null}
                    </div>
                    {img.alt ? (
                      <p
                        className="line-clamp-1 border-t bg-card/50 px-1.5 py-1 text-[10px] text-muted-foreground"
                        title={img.alt}
                      >
                        {img.alt}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <p className="rounded-md border border-dashed bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        {t("readOnlyEditHint")}
      </p>
    </section>
  );
}

function GroupHeader({
  group,
  count,
  t,
}: {
  group: Group;
  count: number;
  t: ReturnType<typeof useTranslations<"admin.products.form.images">>;
}): JSX.Element {
  const Icon = group.kind === "color" ? Palette : group.kind === "variant" ? Wrench : Box;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {group.swatchHex ? (
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                style={{ backgroundColor: group.swatchHex }}
              />
            ) : null}
            {group.label}
          </p>
          {group.subLabel ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">{group.subLabel}</p>
          ) : null}
        </div>
      </div>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums">
        {count}
      </span>
      {group.kind === "color" ? (
        <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          {t("sharedByVariantsBadge")}
        </span>
      ) : null}
    </div>
  );
}
