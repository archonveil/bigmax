import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { getTranslations } from "next-intl/server";

import type { AttributeOption } from "@/catalog/category-attributes";
import { CardCartControls } from "@/components/catalog/card-cart-controls";
import { ProductCardMedia } from "@/components/catalog/product-card-media";
import { QuickView } from "@/components/catalog/quick-view";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import type { ProductCardDTO } from "@/server/catalog";

interface ProductCardProps {
  product: ProductCardDTO;
  locale: Locale;
  /** Опции цветов категории (из category-attributes); если пустой массив,
   *  swatch-row не рендерится. */
  colorOptions?: readonly AttributeOption[];
}

/**
 * Карточка товара. Картинка + swatch-row интерактивны (см. `<ProductCardMedia>`):
 * hover/focus swatch'а свапает картинку на вариант этого цвета. Anchor на
 * картинку остаётся для перехода в /product/[slug] (swatch'и используют
 * stopPropagation чтобы клик не считался переходом).
 *
 * Overlay'и `<QuickView>` + `<FavoriteButton>` передаются как children в
 * `ProductCardMedia` — рендерятся поверх картинки.
 */
export async function ProductCard({
  product,
  locale,
  colorOptions = [],
}: ProductCardProps): Promise<JSX.Element> {
  const t = await getTranslations("home");
  const name = localized(product, "name", locale);

  return (
    <article className="group flex h-full flex-col rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
      <ProductCardMedia
        slug={product.slug}
        alt={name}
        defaultImageUrl={product.imageUrl}
        defaultImageSizes={product.imageSizes}
        defaultImageAvifSizes={product.imageAvifSizes}
        variants={product.variants}
        colorOptions={colorOptions}
        locale={locale}
      >
        {/* Overlay: desktop — показывается на hover/focus-within карточки;
            mobile — всегда видна (нет hover). */}
        <QuickView
          slug={product.slug}
          locale={locale}
          buttonClassName="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-100 transition-opacity sm:opacity-0 group-hover:sm:opacity-100 group-focus-within:sm:opacity-100"
        />

        {/* Heart-toggle — всегда видим (mobile + desktop), чтобы юзер мог
            добавлять без hover-а. */}
        <FavoriteButton
          product={{
            productId: product.id,
            slug: product.slug,
            nameRu: product.nameRu,
            nameUz: product.nameUz,
            nameEn: product.nameEn,
            brandName: product.brandName,
            imageUrl: product.imageUrl,
            minPriceCents: product.minPriceCents,
          }}
          className="absolute right-2 top-2"
        />
      </ProductCardMedia>

      {product.brandName ? (
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{product.brandName}</p>
      ) : null}

      <h3 className="mt-1 text-sm font-semibold">
        <Link
          href={`/product/${product.slug}` as never}
          className="line-clamp-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </Link>
      </h3>

      <p className="mt-2 text-base font-semibold text-primary">
        {t("fromPrice", { price: formatCurrencyUzs(product.minPriceCents, locale) })}
      </p>

      {/* Inline-контрол: «В корзину» → stepper [− qty +] после добавления.
          Growing past the text-stack via `mt-auto` — якорит CTA к низу
          карточки, чтобы в сетке кнопки выстраивались одной линией. */}
      <div className="mt-auto pt-3">
        <CardCartControls product={product} colorOptions={colorOptions} />
      </div>
    </article>
  );
}
