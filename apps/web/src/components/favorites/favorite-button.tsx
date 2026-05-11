"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useFavorites, useFavoritesHydrated, type FavoriteItemInput } from "@/favorites/store";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  /** Snapshot продукта для сохранения. */
  product: FavoriteItemInput;
  /** Внешний класс для позиционирования (overlay на карточке) + размера. */
  className?: string;
}

/**
 * Heart-toggle. Зеркалит состояние `useFavorites.has(productId)` и при клике
 * делает `toggle(...)`. Для авторизованного юзера — дополнительно POST/DELETE
 * на `/api/favorites` (fire-and-forget; если offline — локальный state всё
 * равно меняется, sync при следующем visit'е через `<FavoritesSync>`).
 *
 * До `hydrated` рендерим «пустое» состояние (SSR mismatch guard).
 * На `added` запускается двойное «биение» сердца (keyframe heartbeat).
 */
export function FavoriteButton({ product, className }: FavoriteButtonProps): JSX.Element {
  const t = useTranslations("favorites");
  const hydrated = useFavoritesHydrated();
  const toggle = useFavorites((s) => s.toggle);
  const isFav = useFavorites((s) =>
    hydrated ? s.items.some((it) => it.productId === product.productId) : false,
  );
  // Каждый клик по add даёт уникальный `beatKey`; React поменяет `key` на
  // иконке, что перезапустит CSS-анимацию. На remove — без биения.
  const [beatKey, setBeatKey] = useState(0);

  const activeLabel = isFav ? t("removeLabel") : t("addLabel");

  function handleClick(e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const result = toggle(product);
    toast.success(result === "added" ? t("addedToast") : t("removedToast"));

    if (result === "added") {
      setBeatKey((k) => k + 1);
      void fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.productId }),
      }).catch(() => {
        /* offline / unauth — локальный store правильный */
      });
    } else {
      void fetch(`/api/favorites?productId=${encodeURIComponent(product.productId)}`, {
        method: "DELETE",
      }).catch(() => {
        /* offline / unauth — локальный store правильный */
      });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={activeLabel}
      aria-pressed={isFav}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/95 shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Heart
        key={beatKey}
        className={cn(
          "h-4 w-4 transition",
          isFav ? "fill-destructive text-destructive" : "text-muted-foreground",
          beatKey > 0 && isFav && "animate-heartbeat",
        )}
        aria-hidden
      />
    </button>
  );
}
