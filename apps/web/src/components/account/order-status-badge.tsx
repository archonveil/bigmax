/**
 * `<OrderStatusBadge>` — компактный бейдж для `Order.status` (P5-T1).
 *
 * Pure server component: цвет по тону + локализованный текст. Используется
 * в карточках списка заказов и (в будущем — P5-T2) на детальной странице.
 */

import type { OrderStatus } from "@bigmax/db";
import { useTranslations } from "next-intl";

const TONE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed: "bg-blue-100 text-blue-800 ring-blue-200",
  packing: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  shipped: "bg-violet-100 text-violet-800 ring-violet-200",
  delivered: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  cancelled: "bg-rose-100 text-rose-800 ring-rose-200",
  refunded: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  const t = useTranslations("account.orders.statuses");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[status]}`}
    >
      {t(status)}
    </span>
  );
}
