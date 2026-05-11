/**
 * Pure status-чип для Payment (P6-T6). Tone-mapping выровнен с
 * `<OrderStatusBadge>` чтобы admin'у не приходилось переключаться между
 * палитрами. Иконка из `PAYMENT_STATUS_META` — общий source с filter-select'ом.
 */

import { useTranslations } from "next-intl";

import { PAYMENT_STATUS_META } from "@/components/admin/status-meta";

const TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  captured: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-100 text-rose-800 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
  refunded: "bg-violet-100 text-violet-800 ring-violet-200",
  partially_refunded: "bg-indigo-100 text-indigo-800 ring-indigo-200",
};

export function PaymentStatusBadge({ status }: { status: string }): JSX.Element {
  const t = useTranslations("admin.payments.statuses");
  const tone = TONE[status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
  const Icon = PAYMENT_STATUS_META[status]?.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
      data-testid="payment-status-badge"
      data-status={status}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {t(status)}
    </span>
  );
}
