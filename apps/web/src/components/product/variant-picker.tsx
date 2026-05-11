"use client";

import { formatCurrencyUzs, type Locale } from "@bigmax/shared-types";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCart, useCartHydrated } from "@/cart/store";
import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductVariantDTO } from "@/server/catalog";

export interface VariantPickerProduct {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  imageUrl: string | null;
}

interface VariantPickerProps {
  product: VariantPickerProduct;
  variants: ProductVariantDTO[];
  locale: Locale;
  /** Опции цветов категории для swatch-prefix'а в variant-чипах. */
  colorOptions?: readonly AttributeOption[];
  /** Опциональный observer-callback: вызывается каждый раз когда selectedId
   *  меняется (включая initial mount). Parent может слушать чтобы фильтровать
   *  галерею по выбранному варианту. */
  onSelectedChange?: (variantId: string) => void;
}

function labelFor(
  v: ProductVariantDTO,
  fallback: string,
  colorOptions: readonly AttributeOption[],
  locale: Locale,
): string {
  // Локализуем variant.color через option-config если он canonical.
  // Иначе показываем raw value (для legacy / категорий без color attribute).
  const colorOpt = resolveColorOption(v.color, colorOptions);
  const colorLabel = colorOpt ? pickOptionLabel(colorOpt, locale) : v.color;
  const parts = [colorLabel, v.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

export function VariantPicker({
  product,
  variants,
  locale,
  colorOptions = [],
  onSelectedChange,
}: VariantPickerProps): JSX.Element {
  const t = useTranslations("product");
  const tCart = useTranslations("cart");
  const [selectedId, setSelectedId] = useState<string | undefined>(variants[0]?.id);
  // Эмитим в parent (если есть) на каждый change selectedId — включая initial.
  // Реакция на mount тоже нужна (parent узнаёт о default-выборе для filter'а
  // галереи). Зависит ТОЛЬКО от selectedId; callback-функцию читаем как ref-
  // like через `useEffect` без её в deps (parent её обычно стабилизирует, но
  // если нет — лишний emit не страшен, selection не меняется).
  useEffect(() => {
    if (selectedId !== undefined && onSelectedChange) onSelectedChange(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const openSheet = useCart((s) => s.openSheet);
  const hydrated = useCartHydrated();

  const selected =
    (selectedId ? variants.find((v) => v.id === selectedId) : undefined) ?? variants[0];

  // existing — до rehydrate всегда undefined (SSR guard). После — ищется по
  // id выбранного варианта; меняется автоматически при клике на другой чип.
  const existing = useCart((s) =>
    hydrated && selected ? s.items.find((it) => it.variantId === selected.id) : undefined,
  );

  if (!selected) {
    return <p className="text-sm text-muted-foreground">{t("stock.outOfStock")}</p>;
  }

  const inStock = selected.stockQuantity > 0;
  const discounted =
    selected.oldPriceCents !== null && selected.oldPriceCents > selected.priceCents;
  const atStockCap = existing !== undefined && existing.quantity >= selected.stockQuantity;
  const hardCap = existing !== undefined && existing.quantity >= 99;

  function handleAdd(): void {
    if (!selected || !inStock) return;
    add({
      variantId: selected.id,
      productId: product.id,
      productSlug: product.slug,
      nameRu: product.nameRu,
      nameUz: product.nameUz,
      nameEn: product.nameEn,
      brandName: product.brandName,
      imageUrl: product.imageUrl,
      color: selected.color,
      size: selected.size,
      priceCents: selected.priceCents,
      oldPriceCents: selected.oldPriceCents,
    });
    // Не открываем Sheet автоматически — ненавязчивый toast с action'ом
    // «Открыть корзину». Юзер остаётся на карточке и может добавлять варианты.
    toast.success(tCart("addedToCart"), {
      action: { label: tCart("openLabel"), onClick: () => openSheet() },
    });
  }

  return (
    <div className="space-y-4">
      {variants.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("variants.title")}</p>
          <ul className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = v.id === selected.id;
              const out = v.stockQuantity === 0;
              const colorOpt = resolveColorOption(v.color, colorOptions);
              const hex = colorOpt?.color ?? null;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    disabled={out}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors duration-150",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-input hover:border-primary/40",
                      out && "pointer-events-none opacity-50 line-through",
                    )}
                  >
                    {hex ? (
                      <span
                        aria-hidden
                        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                        style={{ backgroundColor: hex }}
                      />
                    ) : null}
                    {labelFor(v, t("variants.unnamed"), colorOptions, locale)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-primary">
            {formatCurrencyUzs(selected.priceCents, locale)}
          </span>
          {discounted ? (
            <span className="text-lg text-muted-foreground line-through">
              {formatCurrencyUzs(selected.oldPriceCents ?? 0, locale)}
            </span>
          ) : null}
        </div>
        <p className={cn("text-sm", inStock ? "text-primary" : "text-muted-foreground")}>
          {inStock ? t("stock.inStock", { count: selected.stockQuantity }) : t("stock.outOfStock")}
        </p>
      </div>

      <div>
        {!inStock ? (
          <Button size="lg" disabled className="w-full sm:w-auto">
            <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
            {tCart("addToCart")}
          </Button>
        ) : !existing ? (
          <Button size="lg" onClick={handleAdd} className="w-full sm:w-auto">
            <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
            {tCart("addToCart")}
          </Button>
        ) : (
          <div className="inline-flex items-stretch overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => dec(selected.id)}
              aria-label={tCart("qtyDecrease")}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center transition hover:bg-accent"
            >
              <Minus className="h-5 w-5" aria-hidden />
            </button>
            <span
              className="min-w-[3rem] self-center px-2 text-center text-base font-semibold tabular-nums"
              aria-live="polite"
            >
              {existing.quantity}
            </span>
            <button
              type="button"
              onClick={() => inc(selected.id)}
              aria-label={tCart("qtyIncrease")}
              disabled={atStockCap || hardCap}
              title={atStockCap ? t("stock.inStock", { count: selected.stockQuantity }) : undefined}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
