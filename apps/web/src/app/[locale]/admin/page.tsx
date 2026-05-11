/**
 * `/admin` — dashboard (P6-T2).
 *
 * Заменяет P6-T1 stub. Пять секций:
 *   1. KPI cards: всего заказов, выручка today/week/month.
 *   2. Заказы по статусам — горизонтальная таблица счётчиков.
 *   3. Топ-5 товаров за 30 дней — qty + приближённая выручка.
 *   4. Low-stock (порог 5) — товары на грани.
 *   5. Очередь pending Uniteller — то, что pull-job worker подбирает.
 *
 * SSR — все 5 секций считаются параллельно через `getDashboardStats`.
 * Cache: `force-dynamic` (admin'у нужны свежие цифры на каждый refresh).
 */

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, isLocale, type Locale } from "@bigmax/shared-types";
import {
  ArrowRight,
  AlertTriangle,
  CircleDollarSign,
  Clock,
  Package,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDashboardStats,
  type DashboardStats,
  type LowStockRow,
  type OrdersByStatus,
  type PendingUnitellerRow,
  type TopProductRow,
} from "@/server/admin-dashboard";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
}

export default async function AdminDashboardPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const stats = await getDashboardStats(new Date());
  const t = await getTranslations("admin.dashboard");

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
            <h2 className="text-2xl font-semibold">{t("title")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          {t("generatedAt", { time: stats.generatedAt.toLocaleTimeString(intlLocale(locale)) })}
        </p>
      </header>

      <KpiCards stats={stats} locale={locale} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersByStatusCard rows={stats.ordersByStatus} />
        <TopProductsCard rows={stats.topProducts} locale={locale} />
      </div>
      <LowStockCard rows={stats.lowStock} />
      <PendingUnitellerCard rows={stats.pendingUniteller} locale={locale} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

async function KpiCards({
  stats,
  locale,
}: {
  stats: DashboardStats;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("admin.dashboard.kpi");
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="dashboard-kpi"
    >
      <Kpi
        icon={<ShoppingBag className="h-4 w-4" aria-hidden />}
        label={t("ordersTotal")}
        value={stats.ordersTotal.toString()}
      />
      <Kpi
        icon={<CircleDollarSign className="h-4 w-4" aria-hidden />}
        label={t("revenueToday")}
        value={formatCurrencyUzs(stats.revenue.today.totalCents, locale)}
        sub={t("ordersCount", { count: stats.revenue.today.count })}
      />
      <Kpi
        icon={<TrendingUp className="h-4 w-4" aria-hidden />}
        label={t("revenueWeek")}
        value={formatCurrencyUzs(stats.revenue.week.totalCents, locale)}
        sub={t("ordersCount", { count: stats.revenue.week.count })}
      />
      <Kpi
        icon={<TrendingUp className="h-4 w-4" aria-hidden />}
        label={t("revenueMonth")}
        value={formatCurrencyUzs(stats.revenue.month.totalCents, locale)}
        sub={t("ordersCount", { count: stats.revenue.month.count })}
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  sub?: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
          {label}
        </CardDescription>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Orders by status
// ---------------------------------------------------------------------------

async function OrdersByStatusCard({ rows }: { rows: OrdersByStatus[] }): Promise<JSX.Element> {
  const t = await getTranslations("admin.dashboard.ordersByStatus");
  return (
    <Card data-testid="dashboard-orders-by-status">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.status}
                className="flex items-center justify-between text-sm"
                data-status={row.status}
              >
                <OrderStatusBadge status={row.status} />
                <span className="font-mono">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------

async function TopProductsCard({
  rows,
  locale,
}: {
  rows: TopProductRow[];
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("admin.dashboard.topProducts");
  return (
    <Card data-testid="dashboard-top-products">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <li
                key={row.productSlug}
                className="flex items-center gap-3 text-sm"
                data-product-slug={row.productSlug}
              >
                <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
                <Package className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate">{row.productName}</span>
                <span className="text-xs text-muted-foreground">
                  {t("qty", { count: row.totalQuantity })}
                </span>
                <span className="font-mono text-xs">
                  {formatCurrencyUzs(row.totalRevenueCents, locale)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

async function LowStockCard({ rows }: { rows: LowStockRow[] }): Promise<JSX.Element> {
  const t = await getTranslations("admin.dashboard.lowStock");
  if (rows.length === 0) {
    return (
      <Card data-testid="dashboard-low-stock-empty">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="dashboard-low-stock">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              key={`${row.variantId}:${row.branchId}`}
              className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
              data-variant-id={row.variantId}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.sku}
                  {row.variantLabel ? ` · ${row.variantLabel}` : ""}
                  {" · "}
                  {t("atBranch", { branch: row.branchName })}
                </p>
              </div>
              <Badge variant={row.quantity === 0 ? "destructive" : "warning"}>
                {t("remaining", { count: row.quantity })}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pending Uniteller queue
// ---------------------------------------------------------------------------

async function PendingUnitellerCard({
  rows,
  locale,
}: {
  rows: PendingUnitellerRow[];
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("admin.dashboard.pendingUniteller");
  return (
    <Card data-testid="dashboard-pending-uniteller">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-sky-500" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.paymentId}
                className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
                data-payment-id={row.paymentId}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono">{row.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAge(row.ageSec, t)} · {formatCurrencyUzs(row.amountCents, locale)}
                  </p>
                </div>
                <Link
                  href={`/admin/orders/${row.orderId}`}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("openOrder")}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAge(
  seconds: number,
  t: Awaited<ReturnType<typeof getTranslations<"admin.dashboard.pendingUniteller">>>,
): string {
  if (seconds < 60) return t("ageSec", { sec: seconds });
  return t("ageMin", { min: Math.floor(seconds / 60) });
}

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
