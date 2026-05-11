/**
 * Статус-чип для заказа (P6-T5). Цвет соответствует семантике state-machine'а.
 * Иконка тянется из `ORDER_STATUS_META` (тот же source, что в filter-select'е) —
 * благодаря этому admin видит одинаковый визуальный язык в фильтрах и таблицах.
 */

import type { OrderStatus } from "@bigmax/db";
import { useTranslations } from "next-intl";

import { ORDER_STATUS_META } from "@/components/admin/status-meta";

const TONE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed: "bg-sky-100 text-sky-800 ring-sky-200",
  packing: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  shipped: "bg-violet-100 text-violet-800 ring-violet-200",
  delivered: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  cancelled: "bg-rose-100 text-rose-800 ring-rose-200",
  refunded: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  const t = useTranslations("admin.orders.statuses");
  const Icon = ORDER_STATUS_META[status]?.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[status]}`}
      data-testid="order-status-badge"
      data-status={status}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {t(status)}
    </span>
  );
}
