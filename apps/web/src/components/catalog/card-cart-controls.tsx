"use client";

import { formatCurrencyUzs, type Locale } from "@bigmax/shared-types";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useCart, useCartHydrated } from "@/cart/store";
import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductCardDTO, ProductCardVariant } from "@/server/catalog";

interface CardCartControlsProps {
  product: ProductCardDTO;
  className?: string;
  /** Color-options категории — для локализации `variant.color` в чипах. */
  colorOptions?: readonly AttributeOption[];
}

/**
 * Inline-контролы на карточке товара:
 *   - Один вариант → кнопка «В корзину» или stepper [− qty +] если уже в корзине.
 *   - Несколько вариантов → сначала чип-пикер (цвет/размер), потом add/stepper
 *     для выбранного. Переключение чипа переключает контролы между вариантами.
 *   - Disabled-ограничения: out-of-stock → «Нет в наличии», qty >= stockQty → `+` disabled.
 *
 * SSR-safe через `useCartHydrated()` — до rehydrate рендерим фиксированное
 * состояние (кнопка «В корзину»), иначе SSR=0 / client=N mismatch.
 */
export function CardCartControls({
  product,
  className,
  colorOptions = [],
}: CardCartControlsProps): JSX.Element {
  const tCart = useTranslations("cart");
  const tProduct = useTranslations("product");
  const locale = useLocale() as Locale;
  const hydrated = useCartHydrated();
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);

  const variants = product.variants;
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    product.defaultVariant?.id ?? "",
  );
  const selected = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) ?? product.defaultVariant ?? null,
    [variants, selectedVariantId, product.defaultVariant],
  );

  const isMulti = variants.length > 1;

  // Ищем позицию по selected variantId. До rehydrate — всегда undefined
  // (SSR guard).
  const existing = useCart((s) =>
    hydrated && selected ? s.items.find((it) => it.variantId === selected.id) : undefined,
  );

  function stop(e: React.SyntheticEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleAdd(e: React.MouseEvent): void {
    stop(e);
    if (!selected) return;
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
    toast.success(tCart("addedToCart"), {
      action: { label: tCart("openLabel"), onClick: () => useCart.getState().openSheet() },
    });
  }

  function handleInc(e: React.MouseEvent): void {
    stop(e);
    if (selected) inc(selected.id);
  }

  function handleDec(e: React.MouseEvent): void {
    stop(e);
    if (selected) dec(selected.id);
  }

  const atStockCap =
    existing !== undefined && selected !== null && existing.quantity >= selected.stockQuantity;
  const hardCap = existing !== undefined && existing.quantity >= 99;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {isMulti ? (
        <VariantChips
          variants={variants}
          selectedId={selected?.id ?? null}
          locale={locale}
          colorOptions={colorOptions}
          onSelect={setSelectedVariantId}
          onPick={stop}
        />
      ) : null}

      {!selected || selected.stockQuantity === 0 ? (
        <Button type="button" size="sm" disabled className="w-full">
          <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
          {tProduct("stock.outOfStock")}
        </Button>
      ) : !existing ? (
        <Button type="button" size="sm" className="w-full" onClick={handleAdd}>
          <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
          {tCart("addToCart")}
        </Button>
      ) : (
        <div className="inline-flex w-full items-stretch overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={handleDec}
            aria-label={tCart("qtyDecrease")}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center transition hover:bg-accent"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <span
            className="flex-1 self-center text-center text-sm font-medium tabular-nums"
            aria-live="polite"
          >
            {existing.quantity}
          </span>
          <button
            type="button"
            onClick={handleInc}
            aria-label={tCart("qtyIncrease")}
            disabled={atStockCap || hardCap}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={
              atStockCap ? tProduct("stock.inStock", { count: selected.stockQuantity }) : undefined
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

interface VariantChipsProps {
  variants: ProductCardVariant[];
  selectedId: string | null;
  locale: Locale;
  colorOptions: readonly AttributeOption[];
  onSelect: (id: string) => void;
  onPick: (e: React.MouseEvent) => void;
}

function VariantChips({
  variants,
  selectedId,
  locale,
  colorOptions,
  onSelect,
  onPick,
}: VariantChipsProps): JSX.Element {
  const tProduct = useTranslations("product");
  const tCart = useTranslations("cart");
  const hydrated = useCartHydrated();
  // Берём stable-ссылку на `items` (Zustand immutable-set сохраняет её
  // до мутации). Map собираем в useMemo — иначе селектор возвращал бы
  // новый объект на каждый рендер → infinite re-render.
  const items = useCart((s) => s.items);
  const inCartByVariant = useMemo<Record<string, number>>(() => {
    if (!hydrated) return {};
    const out: Record<string, number> = {};
    for (const it of items) out[it.variantId] = it.quantity;
    return out;
  }, [hydrated, items]);

  return (
    <ul className="flex flex-wrap gap-1.5">
      {variants.map((v) => {
        const active = v.id === selectedId;
        const out = v.stockQuantity === 0;
        const inCartQty = inCartByVariant[v.id] ?? 0;
        const colorOpt = resolveColorOption(v.color, colorOptions);
        const colorLabel = colorOpt ? pickOptionLabel(colorOpt, locale) : (v.color ?? "");
        const label =
          [colorLabel, v.size].filter(Boolean).join(" · ") ||
          formatCurrencyUzs(v.priceCents, locale);
        const tooltipParts: string[] = [];
        if (out) tooltipParts.push(tProduct("stock.outOfStock"));
        if (inCartQty > 0) tooltipParts.push(tCart("itemsCount", { count: inCartQty }));
        const tooltip = tooltipParts.join(" · ") || undefined;
        return (
          <li key={v.id}>
            <button
              type="button"
              onClick={(e) => {
                onPick(e);
                onSelect(v.id);
              }}
              disabled={out}
              aria-pressed={active}
              title={tooltip}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input text-muted-foreground hover:border-primary/40",
                // Уже в корзине — подчёркиваем ring'ом, чтобы юзер сразу видел
                // какие варианты выбраны. Работает поверх active-состояния.
                inCartQty > 0 && "ring-1 ring-primary/40",
                out && "pointer-events-none line-through opacity-50",
              )}
            >
              <span>{label}</span>
              {inCartQty > 0 ? (
                <span
                  aria-hidden
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                >
                  {inCartQty > 9 ? "9+" : inCartQty}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
