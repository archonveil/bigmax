/**
 * `/admin/payments/[id]` — детальная страница платежа (P6-T6).
 *
 * Секции:
 *  - Header: orderNumber, status-badge, customer, provider/card-mask, amount.
 *  - Actions: Refund (если canRefund) + Recheck (если provider=uniteller).
 *  - Refunds list — история возвратов по этому платежу.
 *  - PaymentLog timeline — audit действий (recheck, refund_completed,
 *    refund_failed, status_change, cancel_failed и т.д.).
 *  - WebhookEvent log — все callback'и Uniteller для этого Order_IDP.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { PaymentStatusBadge } from "@/components/admin/payments/payment-status-badge";
import { RecheckButton } from "@/components/admin/payments/recheck-button";
import { RefundDialog } from "@/components/admin/payments/refund-dialog";
import { getAdminPayment } from "@/server/admin-payments";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
}

export default async function AdminPaymentDetailPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const payment = await getAdminPayment(params.id);
  if (!payment) notFound();

  const t = await getTranslations("admin.payments.detail");
  const tProvider = await getTranslations("admin.payments.providers");
  const tRefundStatus = await getTranslations("admin.payments.refundStatuses");

  const fmtMoney = (cents: number): string =>
    `${(cents / 100).toLocaleString("ru-RU")} ${payment.currency}`;
  const fmtDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="space-y-6" data-testid="admin-payment-detail">
      <AdminBreadcrumbs
        items={[{ labelKey: "payments", href: "/admin/payments" }, { label: payment.orderNumber }]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/payments"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="admin-payment-back"
          >
            {t("back")}
          </Link>
          <h2 className="text-2xl font-semibold">{t("title", { number: payment.orderNumber })}</h2>
          <p className="text-sm text-muted-foreground">
            {t("createdAt", { date: fmtDate(payment.createdAt) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PaymentStatusBadge status={payment.status} />
          <RecheckButton paymentId={payment.id} provider={payment.provider} />
          {payment.canRefund ? (
            <RefundDialog
              paymentId={payment.id}
              refundableRemaining={payment.refundableRemaining}
              currency={payment.currency}
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4" data-testid="admin-payment-summary">
          <h3 className="mb-2 text-sm font-semibold">{t("summary.title")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("summary.order")}</dt>
            <dd>
              <Link
                href={`/admin/orders/${payment.orderId}`}
                className="font-mono text-primary hover:underline"
                data-testid="admin-payment-order-link"
              >
                {payment.orderNumber}
              </Link>
            </dd>
            <dt className="text-muted-foreground">{t("summary.provider")}</dt>
            <dd>{tProvider(payment.provider)}</dd>
            <dt className="text-muted-foreground">{t("summary.amount")}</dt>
            <dd className="font-mono">{fmtMoney(payment.amountCents)}</dd>
            <dt className="text-muted-foreground">{t("summary.refundable")}</dt>
            <dd className="font-mono">{fmtMoney(payment.refundableRemaining)}</dd>
            {payment.capturedAt ? (
              <>
                <dt className="text-muted-foreground">{t("summary.capturedAt")}</dt>
                <dd>{fmtDate(payment.capturedAt)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("summary.updatedAt")}</dt>
            <dd>{fmtDate(payment.updatedAt)}</dd>
          </dl>
        </section>

        <section className="rounded-lg border p-4" data-testid="admin-payment-uniteller">
          <h3 className="mb-2 text-sm font-semibold">{t("uniteller.title")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("uniteller.customer")}</dt>
            <dd>
              {payment.customerName ?? "—"}
              <br />
              <span className="text-xs text-muted-foreground">{payment.customerEmail ?? "—"}</span>
            </dd>
            <dt className="text-muted-foreground">{t("uniteller.orderIdp")}</dt>
            <dd className="font-mono text-xs">{payment.unitellerOrderIdp ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("uniteller.billnumber")}</dt>
            <dd className="font-mono text-xs">{payment.unitellerBillnumber ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("uniteller.responseCode")}</dt>
            <dd className="font-mono text-xs">{payment.unitellerResponseCode ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("uniteller.cardMask")}</dt>
            <dd className="font-mono text-xs">{payment.unitellerCardMask ?? "—"}</dd>
          </dl>
        </section>
      </div>

      {payment.refunds.length > 0 ? (
        <section className="rounded-lg border" data-testid="admin-payment-refunds">
          <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("refunds.title")}</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("refunds.createdAt")}</th>
                <th className="px-3 py-2 text-right">{t("refunds.amount")}</th>
                <th className="px-3 py-2 text-left">{t("refunds.reason")}</th>
                <th className="px-3 py-2 text-left">{t("refunds.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payment.refunds.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.amountCents)}</td>
                  <td className="px-3 py-2">{r.reason}</td>
                  <td className="px-3 py-2">{tRefundStatus(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="rounded-lg border" data-testid="admin-payment-logs">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("logs.title")}</h3>
        {payment.paymentLogs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("logs.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("logs.createdAt")}</th>
                <th className="px-3 py-2 text-left">{t("logs.action")}</th>
                <th className="px-3 py-2 text-right">{t("logs.statusCode")}</th>
                <th className="px-3 py-2 text-left">{t("logs.errorMessage")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payment.paymentLogs.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(l.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.statusCode ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {l.errorMessage ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border" data-testid="admin-payment-webhooks">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("webhooks.title")}</h3>
        {payment.webhookEvents.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("webhooks.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("webhooks.receivedAt")}</th>
                <th className="px-3 py-2 text-left">{t("webhooks.eventType")}</th>
                <th className="px-3 py-2 text-left">{t("webhooks.externalId")}</th>
                <th className="px-3 py-2 text-left">{t("webhooks.processed")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payment.webhookEvents.map((w) => (
                <tr key={w.id}>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(w.receivedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{w.eventType}</td>
                  <td className="px-3 py-2 font-mono text-xs">{w.externalId ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{w.processed ? "✓" : t("webhooks.pending")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
