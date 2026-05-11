/**
 * `/account/orders` — список заказов пользователя (P5-T1, F11/§5 master-prompt).
 *
 * Server-rendered, auth-gated через layout.tsx. Поддерживает querystring
 * `?status=<OrderStatus>&page=<N>`. Размер страницы — `ORDERS_PAGE_SIZE = 10`.
 *
 * UX:
 *   - Фильтр по статусу (Select) — клиент шлёт push на новый querystring.
 *   - Empty-state различает «совсем нет заказов» vs «нет под выбранный статус».
 *   - Каждая карточка — link на `/orders/[id]/success` (P4-T7 страница). P5-T2
 *     заменит её на полноценную деталь-страницу.
 *   - Пагинация — простая Prev/Next + текст «Страница X из Y».
 */

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, isLocale, type Locale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { OrderListFilters } from "@/components/account/order-list-filters";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { getUserOrders, parseOrderListQuery, type OrderListItem } from "@/server/account-orders";

interface OrdersPageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function OrdersPage({
  params,
  searchParams,
}: OrdersPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const session = await auth();
  // Layout уже редиректит гостя — но typeguard для TS.
  if (!session?.user.id) notFound();

  const query = parseOrderListQuery(searchParams);
  const result = await getUserOrders(session.user.id, query);

  const t = await getTranslations("account.orders");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("list.summary", { count: result.total })}
          </p>
        </div>
        <OrderListFilters current={query.status} />
      </header>

      {result.orders.length === 0 ? (
        <EmptyState filtered={query.status !== null} />
      ) : (
        <ul className="space-y-3" data-testid="orders-list">
          {result.orders.map((order) => (
            <OrderCard key={order.id} order={order} locale={locale} />
          ))}
        </ul>
      )}

      {result.pageCount > 1 && (
        <Pagination page={result.page} pageCount={result.pageCount} status={query.status} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка заказа
// ---------------------------------------------------------------------------

async function OrderCard({
  order,
  locale,
}: {
  order: OrderListItem;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.card");
  const dateFormatted = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
  }).format(order.createdAt);

  const paymentLabel =
    order.paymentProvider === "cod"
      ? t("paymentCod")
      : order.paymentProvider === "uniteller"
        ? t("paymentUniteller")
        : null;

  return (
    <li className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/30">
      <Link
        href={`/account/orders/${order.id}`}
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{order.number}</span>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("createdAt", { date: dateFormatted })} ·{" "}
            {t("itemsCount", { count: order.itemsCount })}
            {paymentLabel ? ` · ${paymentLabel}` : ""}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-base font-semibold">
            {formatCurrencyUzs(order.totalCents, locale)}
          </span>
          <span className="text-sm text-primary">{t("viewDetails")} →</span>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

async function EmptyState({ filtered }: { filtered: boolean }): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list");
  if (filtered) {
    return (
      <div
        className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
        data-testid="orders-empty-filtered"
      >
        {t("emptyFiltered")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed p-8 text-center" data-testid="orders-empty">
      <p className="text-base font-medium">{t("empty.title")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("empty.body")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

async function Pagination({
  page,
  pageCount,
  status,
}: {
  page: number;
  pageCount: number;
  status: string | null;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/account/orders?${qs}` : `/account/orders`;
  };

  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="orders-pagination"
    >
      {page > 1 ? (
        <Link className="text-primary hover:underline" href={buildHref(page - 1)}>
          ← {t("prev")}
        </Link>
      ) : (
        <span className="text-muted-foreground">← {t("prev")}</span>
      )}
      <span className="text-muted-foreground">{t("page", { page, total: pageCount })}</span>
      {page < pageCount ? (
        <Link className="text-primary hover:underline" href={buildHref(page + 1)}>
          {t("next")} →
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("next")} →</span>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intlLocale(locale: Locale): string {
  switch (locale) {
    case "ru":
      return "ru-RU";
    case "uz":
      return "uz-UZ";
    case "en":
      return "en-US";
  }
}
