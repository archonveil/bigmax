"use client";

import { Link } from "@bigmax/i18n/navigation";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { selectFavoritesCount, useFavorites, useFavoritesHydrated } from "@/favorites/store";

/**
 * Иконка-сердце в Header с бейджем количества. Ведёт на `/favorites`.
 * Паттерн идентичен `<CartButton>`:
 *   - до rehydrate или при count=0 — бейдж не рендерим (SSR=0 → client=N
 *     mismatch guard);
 *   - >9 → «9+»;
 *   - `aria-live="polite"` + `sr-only` полная фраза для screen-reader'ов.
 */
export function FavoritesHeaderButton(): JSX.Element {
  const t = useTranslations("favorites");
  const hydrated = useFavoritesHydrated();
  const count = useFavorites(selectFavoritesCount);
  const showBadge = hydrated && count > 0;
  const badgeLabel = count > 9 ? "9+" : String(count);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      asChild
      className="relative"
      aria-label={t("openLabel")}
    >
      <Link href="/favorites">
        <Heart className="h-5 w-5" aria-hidden />
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
      </Link>
    </Button>
  );
}
