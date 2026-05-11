import { isLocale, type Locale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Pagination } from "@/components/catalog/pagination";
import { ProductCard } from "@/components/catalog/product-card";
import {
  CATEGORY_PAGE_SIZE,
  isPageSizeOption,
  searchProducts,
  type PageSizeOption,
} from "@/server/catalog";

interface SearchPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({
  params,
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.search" });
  const q = (firstString(searchParams["q"]) ?? "").trim();
  return {
    // Поисковые URL'ы не индексируем — they're long-tail user input.
    robots: { index: false, follow: true },
    title: q.length > 0 ? t("titleWithQuery", { q }) : t("title"),
  };
}

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parsePage(raw: string | string[] | undefined): number {
  const v = firstString(raw);
  if (!v) return 1;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

function parsePageSize(raw: string | string[] | undefined): PageSizeOption {
  const v = firstString(raw);
  if (!v) return CATEGORY_PAGE_SIZE;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && isPageSizeOption(n) ? n : CATEGORY_PAGE_SIZE;
}

export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const locale = params.locale as Locale;
  const q = (firstString(searchParams["q"]) ?? "").trim();
  // Пустой запрос — уходим в каталог (поведение требуется спекой).
  if (q === "") redirect(`/${params.locale}/catalog`);

  const page = parsePage(searchParams["page"]);
  const pageSize = parsePageSize(searchParams["pageSize"]);

  const { items, total, totalPages } = await searchProducts(q, { page, pageSize });
  const t = await getTranslations("search");

  const paginationParams = new URLSearchParams({ q });
  if (pageSize !== CATEGORY_PAGE_SIZE) paginationParams.set("pageSize", String(pageSize));
  const paginationQs = paginationParams.toString();

  return (
    <section className="container py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("resultsTitle", { q })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("itemsCount", { count: total })}</p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("noResults", { q })}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} locale={locale} />
              </li>
            ))}
          </ul>

          <Pagination
            basePath="/search"
            page={page}
            totalPages={totalPages}
            queryString={paginationQs}
          />
        </>
      )}
    </section>
  );
}
