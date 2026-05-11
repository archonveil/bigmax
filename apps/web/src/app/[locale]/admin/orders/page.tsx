/**
 * `/admin/orders` — список заказов (P6-T5).
 *
 * SSR с querystring `?q=&status=&page=N`. Размер страницы 20.
 * Поиск по `Order.number` ИЛИ `User.email` (ILIKE %q%).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { ShoppingBag } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { OrdersBulkTable } from "@/components/admin/orders/orders-bulk-table";
import { OrdersListFilters } from "@/components/admin/orders/orders-list-filters";
import { getAdminOrders, parseAdminOrderListQuery } from "@/server/admin-orders";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminOrdersPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const query = parseAdminOrderListQuery(searchParams);
  const result = await getAdminOrders(query);
  const t = await getTranslations("admin.orders.list");

  return (
    <div className="space-y-6" data-testid="admin-orders">
      <AdminBreadcrumbs items={[{ labelKey: "orders" }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      <OrdersListFilters query={query} />

      {result.items.length === 0 ? (
        <AdminEmptyState icon={ShoppingBag} title={t("empty")} testId="admin-orders-empty" />
      ) : (
        <OrdersBulkTable items={result.items} query={query.q} />
      )}

      {result.pageCount > 1 ? <Pagination result={result} query={query} /> : null}
    </div>
  );
}

async function Pagination({
  result,
  query,
}: {
  result: { page: number; pageCount: number };
  query: { q: string | null; status: string | null; from: Date | null; to: Date | null };
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.status) params.set("status", query.status);
    if (query.from) params.set("from", query.from.toISOString().slice(0, 10));
    if (query.to) params.set("to", query.to.toISOString().slice(0, 10));
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/orders?${qs}` : `/admin/orders`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-orders-pagination"
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
