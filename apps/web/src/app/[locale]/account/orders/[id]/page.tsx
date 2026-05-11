/**
 * `/account/orders/[id]` — детальная страница заказа (P5-T2, F11/§5).
 *
 * SSR, owner-only через `getOrderDetail` (на чужой Order возвращает null →
 * `notFound()`). Рендерит:
 *   - Header с номером заказа, status badge, датой создания.
 *   - Состав (OrderItem[]) — снапшот товара (имя × locale, цвет/размер).
 *   - Доставка (courier + Address ИЛИ pickup + StoreBranch).
 *   - Оплата (provider + status + card mask + billnumber).
 *   - Итого (subtotal/delivery/discount/total).
 *   - Возвраты (Refund[]), если есть.
 *   - Actions (P5-T2): re-order + request refund (через
 *     `<OrderDetailActions>` client island).
 */

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, isLocale, localized, type Locale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { OrderDetailActions } from "@/components/account/order-detail-actions";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { OrderTracker } from "@/components/account/order-tracker";
import { getOrderDetail, type OrderDetail } from "@/server/account-order-detail";
import { validateRefundEligibility } from "@/server/order-actions";
import { validateCancelEligibility } from "@/server/order-cancel";

interface PageProps {
  params: { locale: string; id: string };
}

export default async function OrderDetailPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const session = await auth();
  if (!session?.user.id) notFound(); // layout редиректит, fallback на 404

  const order = await getOrderDetail(session.user.id, params.id);
  if (!order) notFound();

  const t = await getTranslations("account.orders.detail");
  const eligibility = validateRefundEligibility({
    order: { status: order.status },
    payments: order.payments,
    refunds: order.refunds,
  });
  const cancelEligibility = validateCancelEligibility({
    order: { status: order.status },
    payments: order.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      unitellerBillnumber: p.unitellerBillnumber,
      unitellerOrderIdp: order.number,
    })),
    refunds: order.refunds,
  });
  const dateFormatted = formatDate(order.createdAt, locale);

  return (
    <div className="space-y-8">
      <Link
        href="/account/orders"
        className="inline-block text-sm text-muted-foreground hover:underline"
      >
        {t("back")}
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold sm:text-2xl">{order.number}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground">{t("createdAt", { date: dateFormatted })}</p>
        </div>
      </header>

      <OrderTracker status={order.status} />
      <ItemsSection order={order} locale={locale} />
      <TotalsSection order={order} locale={locale} />
      <DeliverySection order={order} locale={locale} />
      <PaymentSection order={order} locale={locale} />
      {order.refunds.length > 0 ? <RefundsSection order={order} locale={locale} /> : null}

      <OrderDetailActions
        orderId={order.id}
        eligibility={eligibility}
        cancelEligibility={cancelEligibility}
        locale={locale}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function ItemsSection({
  order,
  locale,
}: {
  order: OrderDetail;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.detail");
  return (
    <section className="space-y-3" data-testid="detail-items">
      <h2 className="text-base font-semibold">{t("items")}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {order.items.map((item) => {
          const name =
            localized(item.snapshot.product ?? {}, "name", locale) ||
            item.snapshot.product?.nameRu ||
            item.variantId;
          const variantLabel =
            [item.snapshot.color, item.snapshot.size].filter(Boolean).join(" / ") || null;
          return (
            <li key={item.id} className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                {variantLabel ? (
                  <p className="text-xs text-muted-foreground">{variantLabel}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("itemQty", { qty: item.quantity })}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold">
                {formatCurrencyUzs(item.priceCents * item.quantity, locale)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function TotalsSection({
  order,
  locale,
}: {
  order: OrderDetail;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.detail.totals");
  const row = (label: string, value: number, emphasize = false): JSX.Element => (
    <div
      className={`flex justify-between ${emphasize ? "border-t pt-2 text-base font-semibold" : "text-sm"}`}
    >
      <span className={emphasize ? "" : "text-muted-foreground"}>{label}</span>
      <span>{formatCurrencyUzs(value, locale)}</span>
    </div>
  );
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4" data-testid="detail-totals">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <div className="space-y-1.5">
        {row(t("subtotal"), order.subtotalCents)}
        {order.deliveryCostCents > 0 ? row(t("delivery"), order.deliveryCostCents) : null}
        {order.discountCents > 0 ? row(t("discount"), -order.discountCents) : null}
        {row(t("total"), order.totalCents, true)}
      </div>
    </section>
  );
}

async function DeliverySection({
  order,
  locale,
}: {
  order: OrderDetail;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.detail.delivery");
  const isPickup = order.deliveryMethod === "pickup";
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4" data-testid="detail-delivery">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <p className="text-sm">{isPickup ? t("pickup") : t("courier")}</p>
      {!isPickup && order.address ? (
        <div className="space-y-1 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("address")}</p>
          <p>
            {[
              order.address.region,
              order.address.city,
              order.address.district,
              order.address.street,
              order.address.house ? `д. ${order.address.house}` : null,
              order.address.apartment ? `кв. ${order.address.apartment}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
          {order.address.landmark ? (
            <p className="text-xs text-muted-foreground">{order.address.landmark}</p>
          ) : null}
          {order.address.phone ? (
            <p className="text-xs">
              {t("phone")}: {order.address.phone}
            </p>
          ) : null}
        </div>
      ) : null}
      {isPickup && order.branch ? (
        <div className="space-y-1 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("branch")}</p>
          <p className="font-medium">
            {localized(order.branch, "name", locale) || order.branch.nameRu}
          </p>
          <p className="text-xs text-muted-foreground">
            {localized(order.branch, "address", locale) || order.branch.addressRu}
          </p>
          {order.branch.phone ? (
            <p className="text-xs">
              {t("phone")}: {order.branch.phone}
            </p>
          ) : null}
        </div>
      ) : null}
      {order.comment ? (
        <p className="text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("comment")}:
          </span>{" "}
          {order.comment}
        </p>
      ) : null}
    </section>
  );
}

async function PaymentSection({
  order,
  locale,
}: {
  order: OrderDetail;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.detail.payment");
  const tStatus = await getTranslations("orders.status");
  const last = order.payments[0];
  if (!last) return <></>;
  const providerLabel = last.provider === "cod" ? t("cod") : t("uniteller");

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4" data-testid="detail-payment">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <p className="text-sm">{providerLabel}</p>
      <p className="text-xs text-muted-foreground">
        {/* status намеренно из orders.status (P4-T7 namespace) — paid/failed/etc */}
        {paymentStatusLabel(last.status, tStatus)}
      </p>
      {last.unitellerCardMask ? (
        <p className="text-xs">
          {t("card")}: <span className="font-mono">{last.unitellerCardMask}</span>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{formatCurrencyUzs(last.amountCents, locale)}</p>
    </section>
  );
}

async function RefundsSection({
  order,
  locale,
}: {
  order: OrderDetail;
  locale: Locale;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.detail.refunds");
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4" data-testid="detail-refunds">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <ul className="space-y-2">
        {order.refunds.map((r) => (
          <li key={r.id} className="rounded-md border bg-background p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{refundStatusLabel(r.status, t)}</span>
              <span className="font-semibold">{formatCurrencyUzs(r.amountCents, locale)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("createdAt", { date: formatDate(r.createdAt, locale) })}
            </p>
            <p className="mt-1.5 text-xs">{r.reason}</p>
          </li>
        ))}
      </ul>
    </section>
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

function formatDate(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d);
}

function paymentStatusLabel(
  status: string,
  t: Awaited<ReturnType<typeof getTranslations<"orders.status">>>,
): string {
  switch (status) {
    case "captured":
      return t("paid.title");
    case "failed":
    case "cancelled":
      return t("failed.title");
    case "pending":
      return t("polling.title");
    default:
      return status;
  }
}

function refundStatusLabel(
  status: string,
  t: Awaited<ReturnType<typeof getTranslations<"account.orders.detail.refunds">>>,
): string {
  if (status === "pending") return t("statuses.pending");
  if (status === "completed") return t("statuses.completed");
  if (status === "failed") return t("statuses.failed");
  return status;
}
