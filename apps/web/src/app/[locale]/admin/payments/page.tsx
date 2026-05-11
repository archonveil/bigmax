/**
 * `/admin/payments` — список платежей (P6-T6).
 *
 * SSR с querystring `?q=&status=&provider=&page=N`. Размер страницы 20.
 * Поиск по `Order.number` ИЛИ `User.email` (ILIKE %q%).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { CreditCard } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PaymentsBulkTable } from "@/components/admin/payments/payments-bulk-table";
import { PaymentsListFilters } from "@/components/admin/payments/payments-list-filters";
import { getAdminPayments, parseAdminPaymentListQuery } from "@/server/admin-payments";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminPaymentsPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const query = parseAdminPaymentListQuery(searchParams);
  const result = await getAdminPayments(query);
  const t = await getTranslations("admin.payments.list");

  return (
    <div className="space-y-6" data-testid="admin-payments">
      <AdminBreadcrumbs items={[{ labelKey: "payments" }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      <PaymentsListFilters query={query} />

      {result.items.length === 0 ? (
        <AdminEmptyState icon={CreditCard} title={t("empty")} testId="admin-payments-empty" />
      ) : (
        <PaymentsBulkTable items={result.items} query={query.q} />
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
  query: { q: string | null; status: string | null; provider: string | null };
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.status) params.set("status", query.status);
    if (query.provider) params.set("provider", query.provider);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/payments?${qs}` : `/admin/payments`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-payments-pagination"
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
