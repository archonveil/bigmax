"use client";

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { selectSubtotalCents, selectTotalItems, useCart, type CartItem } from "@/cart/store";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Cart Sheet (правая панель). Один на всё приложение — рендерится в Header'е.
 * Open/close-state живёт в cart-store, чтобы любой `AddToCartButton` мог
 * дёрнуть `useCart.openSheet()` и Sheet всплыл.
 */
export function CartSheet(): JSX.Element {
  const t = useTranslations("cart");
  const locale = useLocale() as Locale;
  const isOpen = useCart((s) => s.isOpen);
  const setSheetOpen = useCart((s) => s.setSheetOpen);
  const items = useCart((s) => s.items);
  const totalItems = useCart(selectTotalItems);
  const subtotalCents = useCart(selectSubtotalCents);

  return (
    <Sheet open={isOpen} onOpenChange={setSheetOpen}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("itemsCount", { count: totalItems })}</SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">{t("empty")}</p>
              <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
            </div>
            <Button asChild variant="outline" onClick={() => setSheetOpen(false)}>
              <Link href="/catalog">{t("continueShopping")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="-mx-2 flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
              {items.map((item) => (
                <CartLine key={item.variantId} item={item} locale={locale} />
              ))}
            </ul>

            <SheetFooter className="flex-col !space-x-0 !space-y-3 border-t pt-4">
              <div className="flex w-full items-baseline justify-between text-base font-semibold">
                <span>{t("subtotal")}</span>
                <span>{formatCurrencyUzs(subtotalCents, locale)}</span>
              </div>
              <Button asChild size="lg" className="w-full" onClick={() => setSheetOpen(false)}>
                <Link href="/cart">{t("checkout")}</Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface CartLineProps {
  item: CartItem;
  locale: Locale;
}

function CartLine({ item, locale }: CartLineProps): JSX.Element {
  const t = useTranslations("cart");
  const setSheetOpen = useCart((s) => s.setSheetOpen);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const remove = useCart((s) => s.remove);

  const lineTotal = item.priceCents * item.quantity;
  const variantLabel = [item.color, item.size].filter(Boolean).join(" · ");

  return (
    <li className="flex gap-3 rounded-md border bg-card p-3">
      <Link
        href={`/product/${item.productSlug}` as never}
        onClick={() => setSheetOpen(false)}
        className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-muted"
      >
        <ProductImage src={item.imageUrl} alt="" fill sizes="64px" className="object-cover" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/product/${item.productSlug}` as never}
          onClick={() => setSheetOpen(false)}
          className="line-clamp-2 text-sm font-medium hover:text-primary"
        >
          {localized(item, "name", locale)}
        </Link>
        {variantLabel ? <p className="text-xs text-muted-foreground">{variantLabel}</p> : null}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-md border">
            <button
              type="button"
              onClick={() => dec(item.variantId)}
              aria-label={t("qtyDecrease")}
              className="flex h-8 w-8 items-center justify-center hover:bg-accent"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[2rem] px-1 text-center text-sm tabular-nums">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => inc(item.variantId)}
              aria-label={t("qtyIncrease")}
              className="flex h-8 w-8 items-center justify-center hover:bg-accent"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <span className="text-sm font-semibold text-primary">
            {formatCurrencyUzs(lineTotal, locale)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => remove(item.variantId)}
        aria-label={t("remove")}
        className="self-start text-muted-foreground transition hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}
