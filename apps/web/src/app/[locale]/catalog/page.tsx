import { Link } from "@bigmax/i18n/navigation";
import { isLocale, localized, type Locale } from "@bigmax/shared-types";
import {
  Armchair,
  Baby,
  ChevronRight,
  Droplets,
  Milk,
  Package,
  Shirt,
  Sparkles,
  ToyBrick,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { absoluteUrl, languageAlternates } from "@/seo/config";
import { itemListLd } from "@/seo/json-ld";
import { JsonLd } from "@/seo/json-ld-script";
import { getCategoryTree, type CategoryNode } from "@/server/catalog";

interface CatalogIndexPageProps {
  params: { locale: string };
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  clothing: Shirt,
  toys: ToyBrick,
  food: Milk,
  diapers: Baby,
  hygiene: Droplets,
  feeding: UtensilsCrossed,
  strollers: Baby,
  furniture: Armchair,
  accessories: Sparkles,
};

export async function generateMetadata({ params }: CatalogIndexPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.catalogIndex" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/catalog", params.locale),
      languages: languageAlternates("/catalog"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/catalog", params.locale),
    },
  };
}

export default async function CatalogIndexPage({
  params,
}: CatalogIndexPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const locale = params.locale as Locale;
  const tree = await getCategoryTree();
  const t = await getTranslations("catalog");

  const jsonLd = itemListLd(
    tree.map((c) => ({ name: localized(c, "name", locale), path: `/catalog/${c.slug}` })),
    locale,
  );

  return (
    <section className="container py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{t("indexTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("indexSubtitle")}</p>
      </header>

      {/* Masonry-like packing через CSS multi-column.
          - Mobile: одна колонка, карточки сток с mb-5 (см. CategoryCard).
          - md+: `columns-2` распределяет карточки по 2 колонкам, балансируя
            суммарную высоту → короткие карточки заполняют «пустоты» под
            высокими, без stretching.
          - `gap-x-5` даёт horizontal-промежуток между колонками; vertical
            spacing у каждой карточки через `mb-5`.
          - Каждая `<li>` обязательно с `break-inside-avoid`, иначе CSS-columns
            может разбить карточку между колонок.
          NB: visual reading order становится column-major (сверху-вниз левой
          колонки, потом правой) — это ожидаемо и привычно для catalog'ов. */}
      <ul className="md:columns-2 md:gap-x-5">
        {tree.map((c) => (
          <CategoryCard
            key={c.id}
            cat={c}
            icon={CATEGORY_ICONS[c.slug] ?? Package}
            locale={locale}
            t={t}
          />
        ))}
      </ul>

      <JsonLd data={jsonLd} />
    </section>
  );
}

/**
 * Карточка категории на /catalog: header с иконкой/именем (clickable area
 * на всю шапку), под ней — sub-tree подкатегорий с визуальной иерархией.
 * Каждая subcategory может раскрывать свои children (depth-3) inline.
 */
function CategoryCard({
  cat,
  icon: Icon,
  locale,
  t,
}: {
  cat: CategoryNode;
  icon: LucideIcon;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<"catalog">>>;
}): JSX.Element {
  const name = localized(cat, "name", locale);
  const subCount = countDescendants(cat);

  return (
    <li
      // `mb-5 break-inside-avoid` — для CSS-columns родителя: mb-5 даёт
      // vertical spacing (gap не работает с column-flow), break-inside-avoid
      // запрещает column-break внутри карточки. На mobile (no columns)
      // mb-5 работает как обычный margin между стек'нутыми карточками.
      className="group mb-5 block break-inside-avoid overflow-hidden rounded-xl border bg-card transition-all hover:border-primary/40 hover:shadow-lg"
      data-testid="catalog-index-category"
      data-slug={cat.slug}
    >
      <Link
        href={`/catalog/${cat.slug}` as never}
        className="flex items-center gap-3 border-b bg-gradient-to-br from-primary/5 via-card to-card px-5 py-4 transition-colors group-hover:from-primary/10"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold transition-colors group-hover:text-primary">
            {name}
          </h2>
          {subCount > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("subcategoriesCount", { count: subCount })}
            </p>
          ) : null}
        </div>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden
        />
      </Link>

      {cat.children.length > 0 ? (
        <div className="px-5 py-4">
          <ul className="space-y-1">
            {cat.children.map((sub) => (
              <SubcategoryRow key={sub.id} sub={sub} locale={locale} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Sub-row внутри `<CategoryCard>`. Если у sub нет children — простая ссылка.
 * Если есть — рендерит nested ul с grandchildren (depth-3 visualization).
 */
function SubcategoryRow({ sub, locale }: { sub: CategoryNode; locale: Locale }): JSX.Element {
  const subName = localized(sub, "name", locale);
  const hasGrand = sub.children.length > 0;

  return (
    <li>
      <Link
        href={`/catalog/${sub.slug}` as never}
        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-primary/5 hover:text-primary"
      >
        <span className="truncate font-medium">{subName}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      </Link>
      {hasGrand ? (
        <ul className="ml-2 mt-0.5 flex flex-wrap gap-1.5 border-l border-dashed pl-3">
          {sub.children.map((grand) => (
            <li key={grand.id}>
              <Link
                href={`/catalog/${grand.slug}` as never}
                className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                {localized(grand, "name", locale)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Pure: считает всех потомков (не включая сам узел). */
function countDescendants(node: CategoryNode): number {
  let n = 0;
  function walk(c: CategoryNode): void {
    for (const child of c.children) {
      n += 1;
      walk(child);
    }
  }
  walk(node);
  return n;
}
