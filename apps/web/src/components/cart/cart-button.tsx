"use client";

import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";

import { selectTotalItems, useCart, useCartHydrated } from "@/cart/store";
import { Button } from "@/components/ui/button";

/**
 * Иконка-триггер корзины в Header. Открывает CartSheet (state в useCart).
 *
 * Счётчик-бейдж:
 *   - до rehydrate (SSR + first client render) — не рендерим, иначе
 *     hydration-варнинг (server=0, client=N).
 *   - при count=0 — не рендерим.
 *   - при count>9 — «9+» чтобы не ломать круглый бейдж.
 */
export function CartButton(): JSX.Element {
  const t = useTranslations("cart");
  const openSheet = useCart((s) => s.openSheet);
  const hydrated = useCartHydrated();
  const count = useCart(selectTotalItems);
  const showBadge = hydrated && count > 0;
  const badgeLabel = count > 9 ? "9+" : String(count);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("openLabel")}
      onClick={openSheet}
      className="relative"
    >
      <ShoppingCart className="h-5 w-5" aria-hidden />
      {showBadge ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
        >
          {badgeLabel}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {t("itemsCount", { count })}
      </span>
    </Button>
  );
}
