import { isLocale, localized, type Locale } from "@bigmax/shared-types";
import { FolderTree, LayoutGrid, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { extractColorOptions } from "@/catalog/category-attributes";
import {
  buildFiltersQueryString,
  hasActiveFilters,
  parseAttributeFilters,
  parseCategoryFilters,
} from "@/catalog/filters";
import { parseProductSort, sortQueryValue } from "@/catalog/sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CategoryFilters } from "@/components/catalog/category-filters";
import { CategorySort } from "@/components/catalog/category-sort";
import { CategoryTreeNav } from "@/components/catalog/category-tree-nav";
import { CollapsibleCatalogAside } from "@/components/catalog/collapsible-catalog-aside";
import { CollapsibleSection } from "@/components/catalog/collapsible-section";
import { PageSizeSelector } from "@/components/catalog/page-size-selector";
import { Pagination } from "@/components/catalog/pagination";
import { ProductCard } from "@/components/catalog/product-card";
import { absoluteUrl, languageAlternates } from "@/seo/config";
import { breadcrumbLd, itemListLd } from "@/seo/json-ld";
import { JsonLd } from "@/seo/json-ld-script";
import {
  CATEGORY_PAGE_SIZE,
  getBrandsForCategory,
  getCategoryBySlug,
  getProductsByCategory,
  isPageSizeOption,
  type PageSizeOption,
} from "@/server/catalog";
import { getAllAttributeKeys, getCategoryAttributes } from "@/server/category-attributes";

interface CategoryPageProps {
  params: { locale: string; slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return 1;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

function parsePageSize(raw: string | string[] | undefined): PageSizeOption {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return CATEGORY_PAGE_SIZE;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && isPageSizeOption(n) ? n : CATEGORY_PAGE_SIZE;
}

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const category = await getCategoryBySlug(params.slug);
  if (!category) return {};
  const locale = params.locale as Locale;
  const name = localized(category, "name", locale);
  const t = await getTranslations({ locale: params.locale, namespace: "seo.category" });

  // Индексируем только канонический URL категории: page=1, без фильтров.
  // Остальные варианты фасетов создают бесконечный long-tail дубликатов.
  const page = parsePage(searchParams["page"]);
  const filters = parseCategoryFilters(searchParams);
  const knownKeys = await getAllAttributeKeys();
  const attributes = parseAttributeFilters(searchParams, knownKeys);
  const noindex = page > 1 || hasActiveFilters(filters, attributes);

  return {
    title: t("title", { name }),
    description: t("description", { name }),
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      canonical: absoluteUrl(`/catalog/${category.slug}`, locale),
      languages: languageAlternates(`/catalog/${category.slug}`),
    },
    openGraph: {
      title: t("title", { name }),
      description: t("description", { name }),
      url: absoluteUrl(`/catalog/${category.slug}`, locale),
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const locale = params.locale as Locale;
  const category = await getCategoryBySlug(params.slug);
  if (!category) notFound();

  const page = parsePage(searchParams["page"]);
  const pageSize = parsePageSize(searchParams["pageSize"]);
  const filters = parseCategoryFilters(searchParams);
  const knownKeys = await getAllAttributeKeys();
  const attributes = parseAttributeFilters(searchParams, knownKeys);
  const sort = parseProductSort(searchParams["sort"]);

  const [{ items, total, totalPages }, brands, attributeConfigs] = await Promise.all([
    getProductsByCategory(category.id, { page, pageSize, filters, attributes, sort }),
    getBrandsForCategory(category.id),
    getCategoryAttributes(category.id),
  ]);
  // Опции цветов категории — для рендеринга swatch'ей в карточках товара.
  const colorOptions = extractColorOptions(attributeConfigs);

  const t = await getTranslations("catalog");
  const tNav = await getTranslations("nav");
  const tTree = await getTranslations("catalog.treeNav");
  const name = localized(category, "name", locale);

  // JSON-LD: BreadcrumbList + ItemList (первая страница, без фильтров).
  // Multi-level: используем полную цепочку предков (root → … → parent) из
  // `category.ancestors`, плюс сам current на конце.
  const breadcrumbItems = [
    { name: t("indexTitle"), path: "/catalog" },
    ...category.ancestors.map((a) => ({
      name: localized(a, "name", locale),
      path: `/catalog/${a.slug}`,
    })),
    { name, path: `/catalog/${category.slug}` },
  ];
  const jsonLd = [
    breadcrumbLd(breadcrumbItems, locale),
    itemListLd(
      items.map((p) => ({ name: localized(p, "name", locale), path: `/product/${p.slug}` })),
      locale,
    ),
  ];

  // Фильтры (включая attr.*), sort и pageSize сохраняем в href'ах пагинации.
  const paginationParams = new URLSearchParams(buildFiltersQueryString(filters, attributes));
  if (pageSize !== CATEGORY_PAGE_SIZE) paginationParams.set("pageSize", String(pageSize));
  const sortParam = sortQueryValue(sort);
  if (sortParam) paginationParams.set("sort", sortParam);
  const paginationQs = paginationParams.toString();

  return (
    <section className="container py-10">
      {/* Two-column layout: sidebar занимает полную высоту секции, всё
          остальное (breadcrumbs, header, items, pagination) живёт в правой
          колонке сверху-вниз. `auto_1fr` чтобы collapsed-sidebar не занимал
          лишнюю ширину; `items-start` чтобы оба col-track'а начинались с
          одного top. */}
      <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
        <CollapsibleCatalogAside>
          <CollapsibleSection
            storageKey="catalog-tree-open"
            title={tTree("treeSection")}
            icon={<FolderTree className="h-3.5 w-3.5" aria-hidden />}
          >
            <CategoryTreeNav currentSlug={category.slug} locale={locale} />
          </CollapsibleSection>

          <CollapsibleSection
            storageKey="catalog-filters-open"
            title={tTree("filtersSection")}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />}
          >
            {/*
              key={category.slug} — при переходе на другую категорию
              перемонтируем фильтры, чтобы state не тянул значения со старой.
              Внутри одной категории state остаётся стабильным (source of truth
              для UI — локальный useState, а не prop `initial`).
            */}
            <CategoryFilters
              key={category.slug}
              initial={filters}
              initialAttributes={attributes}
              brands={brands.map((b) => ({ slug: b.slug, name: b.name }))}
              attributeConfigs={attributeConfigs}
              locale={locale}
            />
          </CollapsibleSection>
        </CollapsibleCatalogAside>

        <div className="min-w-0 space-y-6">
          <Breadcrumbs
            homeLabel={tNav("home")}
            items={[
              { href: "/catalog", label: t("indexTitle"), icon: LayoutGrid },
              ...category.ancestors.map((a) => ({
                href: `/catalog/${a.slug}`,
                label: localized(a, "name", locale),
              })),
              { label: name },
            ]}
          />

          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">{name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("itemsCount", { count: total })}
              </p>
            </div>
            {total > 0 ? (
              <div className="flex flex-wrap items-center gap-4">
                <PageSizeSelector value={pageSize} />
                <CategorySort value={sort} />
              </div>
            ) : null}
          </header>

          {items.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
                {items.map((p) => (
                  <li key={p.id}>
                    <ProductCard product={p} locale={locale} colorOptions={colorOptions} />
                  </li>
                ))}
              </ul>

              <Pagination
                basePath={`/catalog/${params.slug}`}
                page={page}
                totalPages={totalPages}
                queryString={paginationQs}
              />
            </>
          )}
        </div>
      </div>

      <JsonLd data={jsonLd} />
    </section>
  );
}
