"use client";

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { Heart, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { FavoriteButton } from "@/components/favorites/favorite-button";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import {
  selectFavoriteItems,
  useFavorites,
  useFavoritesHydrated,
  type FavoriteItem,
} from "@/favorites/store";

/**
 * Страница /favorites. До rehydrate — спиннер. После — либо empty-state,
 * либо грид карточек с кнопкой удаления и ссылкой на страницу товара.
 */
export function FavoritesPageClient(): JSX.Element {
  const t = useTranslations("favorites");
  const locale = useLocale() as Locale;
  const hydrated = useFavoritesHydrated();
  const items = useFavorites(selectFavoriteItems);

  if (!hydrated) {
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("pageTitle")}</h1>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("pageTitle")}</h1>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <Heart className="h-12 w-12 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-lg font-medium">{t("empty")}</p>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </div>
          <Button asChild>
            <Link href="/catalog">{t("continueShopping")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="container py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("itemsCount", { count: items.length })}</p>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.productId}>
            <FavoriteCard item={item} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface FavoriteCardProps {
  item: FavoriteItem;
  locale: Locale;
}

function FavoriteCard({ item, locale }: FavoriteCardProps): JSX.Element {
  const tHome = useTranslations("home");

  return (
    <article className="group flex h-full flex-col rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <div className="relative mb-4 aspect-square overflow-hidden rounded-md bg-muted">
        <Link
          href={`/product/${item.slug}` as never}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={localized(item, "name", locale)}
        >
          <ProductImage
            src={item.imageUrl}
            alt={localized(item, "name", locale)}
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition group-hover:scale-105"
          />
        </Link>

        {/* Единый toggle — тот же компонент, что на каталоге. На `/favorites`
            всегда активен; клик → remove + карточка исчезает на следующем
            рендере. UX унифицирован: сердце как flip-toggle везде. */}
        <FavoriteButton
          product={{
            productId: item.productId,
            slug: item.slug,
            nameRu: item.nameRu,
            nameUz: item.nameUz,
            nameEn: item.nameEn,
            brandName: item.brandName,
            imageUrl: item.imageUrl,
            minPriceCents: item.minPriceCents,
          }}
          className="absolute right-2 top-2"
        />
      </div>

      {item.brandName ? (
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.brandName}</p>
      ) : null}
      <h3 className="mt-1 text-sm font-semibold">
        <Link
          href={`/product/${item.slug}` as never}
          className="line-clamp-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {localized(item, "name", locale)}
        </Link>
      </h3>
      <p className="mt-2 text-base font-semibold text-primary">
        {tHome("fromPrice", { price: formatCurrencyUzs(item.minPriceCents, locale) })}
      </p>
    </article>
  );
}
