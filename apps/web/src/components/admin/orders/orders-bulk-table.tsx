"use client";

/**
 * `<OrdersBulkTable>` (P6-T5 follow-up, closes open question (c)).
 *
 * Wraps списочную таблицу заказов: добавляет checkbox в каждую строку
 * и floating bulk-bar над таблицей. Bar появляется при `selected.size > 0`
 * с select'ом target-статуса + reason input + кнопкой Apply. Submit бьёт
 * `POST /api/admin/orders/bulk` → `toast` с `{updated, skipped}` →
 * `router.refresh()`. Pattern скопирован из `<CategoryTree>` (P6-T4 follow-up).
 */

import type { OrderStatus } from "@bigmax/db";
import { Link } from "@bigmax/i18n/navigation";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { OrderStatusBadge } from "@/components/admin/orders/order-status-badge";
import { ORDER_STATUS_META, StatusOption } from "@/components/admin/status-meta";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminOrderListItem } from "@/server/admin-orders";

const STATUSES: ReadonlyArray<OrderStatus> = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

interface BulkResponse {
  ok: boolean;
  updated: number;
  skipped: Array<{ id: string; reason: string }>;
}

interface OrdersBulkTableProps {
  items: AdminOrderListItem[];
  /** Для подсветки совпадений в строках. Передаётся из page.tsx (`query.q`). */
  query?: string | null;
}

export function OrdersBulkTable({ items, query }: OrdersBulkTableProps): JSX.Element {
  const t = useTranslations("admin.orders.list");
  const tBulk = useTranslations("admin.orders.bulk");
  const tStatus = useTranslations("admin.orders.statuses");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<OrderStatus>("confirmed");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  };

  const onApply = async (): Promise<void> => {
    if (submitting || selected.size === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(tBulk("confirm", { count: selected.size }))
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          status: target,
          ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        toast.error(tBulk("error"));
        return;
      }
      const body = (await res.json()) as BulkResponse;
      if (body.skipped.length === 0) {
        toast.success(tBulk("successAll", { count: body.updated }));
      } else {
        toast.success(
          tBulk("successPartial", { updated: body.updated, skipped: body.skipped.length }),
        );
      }
      setSelected(new Set());
      setReason("");
      router.refresh();
    } catch {
      toast.error(tBulk("error"));
    } finally {
      setSubmitting(false);
    }
  };

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <>
      {selected.size > 0 ? (
        <div
          className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm"
          data-testid="admin-orders-bulk-bar"
        >
          <span className="text-sm font-medium">{tBulk("selected", { count: selected.size })}</span>
          <Select
            value={target}
            onValueChange={(v) => setTarget(v as OrderStatus)}
            disabled={submitting}
          >
            <SelectTrigger data-testid="admin-orders-bulk-target" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => {
                const meta = ORDER_STATUS_META[s];
                return (
                  <SelectItem key={s} value={s}>
                    <StatusOption dot={meta?.dot} icon={meta?.icon} label={tStatus(s)} />
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Input
            type="text"
            placeholder={tBulk("reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            maxLength={500}
            className="max-w-sm"
            data-testid="admin-orders-bulk-reason"
          />
          <Button
            onClick={() => void onApply()}
            disabled={submitting}
            data-testid="admin-orders-bulk-apply"
          >
            {submitting ? tBulk("applying") : tBulk("apply")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={submitting}
            data-testid="admin-orders-bulk-clear"
          >
            {tBulk("clear")}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="admin-orders-table">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  data-testid="admin-orders-select-all"
                  aria-label={tBulk("selectAll")}
                />
              </th>
              <th className="px-3 py-2 text-left">{t("table.number")}</th>
              <th className="px-3 py-2 text-left">{t("table.createdAt")}</th>
              <th className="px-3 py-2 text-left">{t("table.customer")}</th>
              <th className="px-3 py-2 text-right">{t("table.items")}</th>
              <th className="px-3 py-2 text-right">{t("table.total")}</th>
              <th className="px-3 py-2 text-left">{t("table.payment")}</th>
              <th className="px-3 py-2 text-left">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((o) => (
              <tr
                key={o.id}
                className="hover:bg-accent/30"
                data-testid="admin-orders-row"
                data-order-id={o.id}
              >
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected.has(o.id)}
                    onCheckedChange={() => toggle(o.id)}
                    data-testid="admin-orders-row-checkbox"
                    aria-label={tBulk("selectRow")}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="font-mono text-sm font-medium text-primary hover:underline"
                  >
                    <Highlight text={o.number} query={query} />
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {o.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">
                  <div>
                    {o.customerName ? <Highlight text={o.customerName} query={query} /> : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.customerEmail ? <Highlight text={o.customerEmail} query={query} /> : "—"}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono">{o.itemsCount}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {(o.totalCents / 100).toLocaleString("ru-RU")} {o.currency}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {o.paymentProvider ? (
                    <>
                      {o.paymentProvider}
                      <span className="ml-1 text-muted-foreground/70">
                        {o.paymentStatus ?? "—"}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <OrderStatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
