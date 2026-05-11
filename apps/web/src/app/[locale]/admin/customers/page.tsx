/**
 * `/admin/customers` — список клиентов (P6-T8 + follow-up bulk-role).
 *
 * SSR с querystring `?q=&role=&page=N`. Page-size 20. Поиск по
 * `email`/`phone`/`name` ILIKE. Использует `<CustomersBulkTable>` для
 * per-row checkbox + sticky bulk-bar (P6-T8 follow-up — closes (d)).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { Users } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CustomersBulkTable } from "@/components/admin/customers/customers-bulk-table";
import { CustomersListFilters } from "@/components/admin/customers/customers-list-filters";
import { getAdminCustomers, parseAdminCustomerListQuery } from "@/server/admin-customers";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminCustomersPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const query = parseAdminCustomerListQuery(searchParams);
  const result = await getAdminCustomers(query);
  const t = await getTranslations("admin.customers.list");

  return (
    <div className="space-y-6" data-testid="admin-customers">
      <AdminBreadcrumbs items={[{ labelKey: "customers" }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      <CustomersListFilters query={query} />

      <p className="text-xs text-muted-foreground">{t("summary", { count: result.total })}</p>

      {result.items.length === 0 ? (
        <AdminEmptyState icon={Users} title={t("empty")} testId="admin-customers-empty" />
      ) : (
        <CustomersBulkTable items={result.items} query={query.q} />
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
  query: { q: string | null; role: string | null };
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.role) params.set("role", query.role);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/customers?${qs}` : `/admin/customers`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-customers-pagination"
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
