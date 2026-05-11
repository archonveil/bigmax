/**
 * `/admin/products` — список товаров (P6-T3).
 *
 * SSR с querystring `?q=...&active=true|false&page=N`. Размер страницы 20.
 * Поиск по `nameRu` (ILIKE %q%); active-фильтр через select.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale, type Locale } from "@bigmax/shared-types";
import { Eye, EyeOff, Package, Plus, Sparkles, Upload } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ProductsListFilters } from "@/components/admin/products/products-list-filters";
import { Highlight } from "@/components/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminProducts, parseAdminProductListQuery } from "@/server/admin-products";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminProductsPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const query = parseAdminProductListQuery(searchParams);
  const result = await getAdminProducts(query);
  const t = await getTranslations("admin.products.list");

  return (
    <div className="space-y-6" data-testid="admin-products">
      <AdminBreadcrumbs items={[{ labelKey: "products" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/products/import" data-testid="admin-products-import-link">
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                {t("import")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/products/new" data-testid="admin-products-create-link">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t("create")}
              </Link>
            </Button>
          </>
        }
      />

      <ProductsListFilters query={query} />

      <p className="text-xs text-muted-foreground">{t("summary", { count: result.total })}</p>

      {result.items.length === 0 ? (
        <AdminEmptyState icon={Package} title={t("empty")} testId="admin-products-empty" />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-products-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.category")}</TableHead>
                <TableHead>{t("table.brand")}</TableHead>
                <TableHead className="text-right">{t("table.variants")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id} data-testid="admin-products-row" data-product-id={p.id}>
                  <TableCell>
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      <Highlight text={p.nameRu} query={query.q} />
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      <Highlight text={p.slug} query={query.q} />
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.categoryNameRu}</TableCell>
                  <TableCell className="text-muted-foreground">{p.brandName ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{p.variantCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={p.isActive ? "success" : "muted"} className="gap-1">
                        {p.isActive ? (
                          <Eye className="h-3 w-3" aria-hidden />
                        ) : (
                          <EyeOff className="h-3 w-3" aria-hidden />
                        )}
                        {p.isActive ? t("table.active") : t("table.inactive")}
                      </Badge>
                      {p.isFeatured ? (
                        <Badge variant="warning" className="gap-1">
                          <Sparkles className="h-3 w-3" aria-hidden />
                          {t("table.featured")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.pageCount > 1 ? <Pagination result={result} query={query} /> : null}

      <noscript>
        <p className="text-xs text-muted-foreground">
          JavaScript отключён — фильтр работает через querystring (?q=, ?active=).
        </p>
      </noscript>
      {void locale}
    </div>
  );
}

async function Pagination({
  result,
  query,
}: {
  result: { page: number; pageCount: number };
  query: { q: string | null; active: boolean | null };
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.active !== null) params.set("active", String(query.active));
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/products?${qs}` : `/admin/products`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-products-pagination"
    >
      {result.page > 1 ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page - 1)}>
          ← {t("prev")}
        </Link>
      ) : (
        <span className="text-muted-foreground">← {t("prev")}</span>
      )}
      <span className="text-muted-foreground">
        {t("page", { page: result.page, total: result.pageCount })}
      </span>
      {result.page < result.pageCount ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page + 1)}>
          {t("next")} →
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("next")} →</span>
      )}
    </nav>
  );
}
