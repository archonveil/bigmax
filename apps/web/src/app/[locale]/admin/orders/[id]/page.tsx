/**
 * `/admin/orders/[id]` — детальная страница заказа (P6-T5).
 *
 * Показывает всё, что нужно admin'у: customer, delivery, items, totals,
 * payments, refunds + state-machine UI для смены статуса + кнопка
 * скачивания PDF-накладной.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { OrderStatusBadge } from "@/components/admin/orders/order-status-badge";
import { OrderStatusChanger } from "@/components/admin/orders/order-status-changer";
import { Button } from "@/components/ui/button";
import { allowedTransitionsFrom, getAdminOrder } from "@/server/admin-orders";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
}

export default async function AdminOrderDetailPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const order = await getAdminOrder(params.id);
  if (!order) notFound();

  const t = await getTranslations("admin.orders.detail");
  const tList = await getTranslations("admin.orders.list");
  const tInvoice = await getTranslations("admin.orders.detail.invoice");
  const allowed = allowedTransitionsFrom(order.status);

  const fmtMoney = (cents: number): string =>
    `${(cents / 100).toLocaleString("ru-RU")} ${order.currency}`;
  const fmtDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

  const addressLine = order.address
    ? [
        order.address.region,
        order.address.city,
        order.address.district,
        order.address.street,
        order.address.house,
        order.address.apartment ? `кв. ${order.address.apartment}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <div className="space-y-6" data-testid="admin-order-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "orders", href: "/admin/orders" }, { label: order.number }]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/orders"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="admin-order-back"
          >
            {t("back")}
          </Link>
          <h2 className="text-2xl font-semibold">{t("title", { number: order.number })}</h2>
          <p className="text-sm text-muted-foreground">
            {t("createdAt", { date: fmtDate(order.createdAt) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <Button asChild variant="outline">
            <a
              href={`/api/admin/orders/${order.id}/invoice.pdf`}
              data-testid="admin-order-invoice-link"
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {tInvoice("download")}
            </a>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4" data-testid="admin-order-customer">
          <h3 className="mb-2 text-sm font-semibold">{t("customer.title")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("customer.name")}</dt>
            <dd>{order.customer.name ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("customer.email")}</dt>
            <dd>{order.customer.email ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("customer.phone")}</dt>
            <dd>{order.customer.phone ?? "—"}</dd>
          </dl>
        </section>

        <section className="rounded-lg border p-4" data-testid="admin-order-delivery">
          <h3 className="mb-2 text-sm font-semibold">{t("delivery.title")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("delivery.method")}</dt>
            <dd>
              {order.deliveryMethod === "courier" ? t("delivery.courier") : t("delivery.pickup")}
            </dd>
            {addressLine ? (
              <>
                <dt className="text-muted-foreground">{t("delivery.address")}</dt>
                <dd>{addressLine}</dd>
              </>
            ) : null}
            {order.branch ? (
              <>
                <dt className="text-muted-foreground">{t("delivery.branch")}</dt>
                <dd>
                  {order.branch.nameRu}
                  <br />
                  <span className="text-muted-foreground">{order.branch.addressRu}</span>
                </dd>
              </>
            ) : null}
            {order.comment ? (
              <>
                <dt className="text-muted-foreground">{t("delivery.comment")}</dt>
                <dd>{order.comment}</dd>
              </>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="rounded-lg border" data-testid="admin-order-items">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("items.title")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("items.name")}</th>
                <th className="px-3 py-2 text-right">{t("items.qty")}</th>
                <th className="px-3 py-2 text-right">{t("items.price")}</th>
                <th className="px-3 py-2 text-right">{t("items.sum")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.items.map((it) => {
                const productName = it.snapshot.product?.nameRu ?? tList("table.items");
                const variants = [it.snapshot.color, it.snapshot.size].filter(Boolean).join(", ");
                return (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      <div>{productName}</div>
                      {variants ? (
                        <div className="text-xs text-muted-foreground">{variants}</div>
                      ) : null}
                      {it.snapshot.sku ? (
                        <div className="font-mono text-xs text-muted-foreground">
                          {it.snapshot.sku}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(it.priceCents)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtMoney(it.priceCents * it.quantity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/20 text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-muted-foreground">
                  {t("totals.subtotal")}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {fmtMoney(order.subtotalCents)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right text-muted-foreground">
                  {t("totals.delivery")}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {fmtMoney(order.deliveryCostCents)}
                </td>
              </tr>
              {order.discountCents > 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-1.5 text-right text-muted-foreground">
                    {t("totals.discount")}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    −{fmtMoney(order.discountCents)}
                  </td>
                </tr>
              ) : null}
              <tr className="border-t">
                <td colSpan={3} className="px-3 py-2 text-right font-semibold">
                  {t("totals.total")}
                </td>
                <td className="px-3 py-2 text-right font-mono text-base font-semibold">
                  {fmtMoney(order.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4" data-testid="admin-order-payments">
        <h3 className="mb-2 text-sm font-semibold">{t("payments.title")}</h3>
        {order.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("payments.empty")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {order.payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <div className="font-medium">
                    {p.provider} · {p.status}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {p.unitellerBillnumber ?? "—"} · {p.unitellerCardMask ?? "—"}
                  </div>
                </div>
                <div className="font-mono">{fmtMoney(p.amountCents)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {order.refunds.length > 0 ? (
        <section className="rounded-lg border p-4" data-testid="admin-order-refunds">
          <h3 className="mb-2 text-sm font-semibold">{t("refunds.title")}</h3>
          <ul className="space-y-2 text-sm">
            {order.refunds.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <div className="font-medium">{r.status}</div>
                  <div className="text-xs text-muted-foreground">{r.reason}</div>
                </div>
                <div className="font-mono">{fmtMoney(r.amountCents)}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <OrderStatusChanger orderId={order.id} current={order.status} allowed={allowed} />
    </div>
  );
}
