"use client";

/**
 * `<PaymentsBulkTable>` (P6-T6 follow-up — closes (d) bulk refund).
 *
 * Wrap'ит таблицу платежей: per-row checkbox + sticky bulk-bar. Bar
 * появляется при `selected.size > 0` с radio mode (full | fixed) +
 * amount input (для fixed) + reason input + Apply. Submit бьёт
 * `POST /api/admin/payments/bulk-refund` → `toast` с `{processed, skipped}` →
 * `router.refresh()`. Pattern ровно как в `<OrdersBulkTable>` (P6-T5 follow-up).
 *
 * **NB**: bulk-refund разрешён только для платежей со статусом
 * `captured`/`partially_refunded`. UI всё равно позволяет выбрать любую
 * строку — backend отсеет нерефандабельные через `not_refundable` в
 * `skipped[]`. Так admin'у проще видеть какие платежи не подлежат
 * возврату вместо disabled-checkbox'ов с непонятной причиной.
 */

import { Link } from "@bigmax/i18n/navigation";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { PaymentStatusBadge } from "@/components/admin/payments/payment-status-badge";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminPaymentListItem } from "@/server/admin-payments";

interface BulkResponse {
  ok: boolean;
  processed: Array<{ paymentId: string; amountCents: number }>;
  skipped: Array<{ paymentId: string; reason: string; message?: string }>;
}

interface PaymentsBulkTableProps {
  items: AdminPaymentListItem[];
  query?: string | null;
}

export function PaymentsBulkTable({ items, query }: PaymentsBulkTableProps): JSX.Element {
  const t = useTranslations("admin.payments.list");
  const tProvider = useTranslations("admin.payments.providers");
  const tBulk = useTranslations("admin.payments.bulkRefund");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"full" | "fixed">("full");
  const [amount, setAmount] = useState("");
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

  const confirm = useConfirm();
  const onApply = async (): Promise<void> => {
    if (submitting || selected.size === 0) return;
    if (reason.trim().length < 3) {
      toast.error(tBulk("reasonRequired"));
      return;
    }
    if (mode === "fixed") {
      const n = Number.parseFloat(amount);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(tBulk("invalidAmount"));
        return;
      }
    }
    if (!(await confirm({ description: tBulk("confirm", { count: selected.size }) }))) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        paymentIds: Array.from(selected),
        reason: reason.trim(),
        mode,
      };
      if (mode === "fixed") {
        payload["amountCents"] = Math.round(Number.parseFloat(amount) * 100);
      }
      const res = await fetch("/api/admin/payments/bulk-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error(tBulk("error"));
        return;
      }
      const body = (await res.json()) as BulkResponse;
      if (body.skipped.length === 0) {
        toast.success(tBulk("successAll", { count: body.processed.length }));
      } else {
        toast.success(
          tBulk("successPartial", {
            processed: body.processed.length,
            skipped: body.skipped.length,
          }),
        );
      }
      setSelected(new Set());
      setAmount("");
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
          className="sticky top-2 z-10 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm"
          data-testid="admin-payments-bulk-bar"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {tBulk("selected", { count: selected.size })}
            </span>
            <fieldset className="flex items-center gap-3 text-sm">
              <legend className="sr-only">{tBulk("modeLegend")}</legend>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name="bulk-refund-mode"
                  value="full"
                  checked={mode === "full"}
                  onChange={() => setMode("full")}
                  disabled={submitting}
                  data-testid="admin-payments-bulk-mode-full"
                />
                {tBulk("modeFull")}
              </label>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name="bulk-refund-mode"
                  value="fixed"
                  checked={mode === "fixed"}
                  onChange={() => setMode("fixed")}
                  disabled={submitting}
                  data-testid="admin-payments-bulk-mode-fixed"
                />
                {tBulk("modeFixed")}
              </label>
            </fieldset>
            {mode === "fixed" ? (
              <div className="flex flex-col">
                <Label htmlFor="bulk-amount" className="text-xs text-muted-foreground">
                  {tBulk("amountLabel")}
                </Label>
                <Input
                  id="bulk-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                  className="w-[150px]"
                  data-testid="admin-payments-bulk-amount"
                />
              </div>
            ) : null}
            <div className="flex flex-col flex-1 min-w-[200px]">
              <Label htmlFor="bulk-reason" className="text-xs text-muted-foreground">
                {tBulk("reasonLabel")}
              </Label>
              <Input
                id="bulk-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                maxLength={500}
                placeholder={tBulk("reasonPlaceholder")}
                data-testid="admin-payments-bulk-reason"
              />
            </div>
            <Button
              variant="destructive"
              onClick={() => void onApply()}
              disabled={submitting}
              data-testid="admin-payments-bulk-apply"
            >
              {submitting ? tBulk("applying") : tBulk("apply")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={submitting}
              data-testid="admin-payments-bulk-clear"
            >
              {tBulk("clear")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="admin-payments-table">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  data-testid="admin-payments-select-all"
                  aria-label={tBulk("selectAll")}
                />
              </th>
              <th className="px-3 py-2 text-left">{t("table.order")}</th>
              <th className="px-3 py-2 text-left">{t("table.createdAt")}</th>
              <th className="px-3 py-2 text-left">{t("table.customer")}</th>
              <th className="px-3 py-2 text-left">{t("table.provider")}</th>
              <th className="px-3 py-2 text-right">{t("table.amount")}</th>
              <th className="px-3 py-2 text-left">{t("table.card")}</th>
              <th className="px-3 py-2 text-left">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr
                key={p.id}
                className="hover:bg-accent/30"
                data-testid="admin-payments-row"
                data-payment-id={p.id}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    data-testid="admin-payments-row-checkbox"
                    aria-label={tBulk("selectRow")}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/payments/${p.id}`}
                    className="font-mono text-sm font-medium text-primary hover:underline"
                  >
                    <Highlight text={p.orderNumber} query={query} />
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {p.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">
                  <div>
                    {p.customerName ? <Highlight text={p.customerName} query={query} /> : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.customerEmail ? <Highlight text={p.customerEmail} query={query} /> : "—"}
                  </div>
                </td>
                <td className="px-3 py-2">{tProvider(p.provider)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {(p.amountCents / 100).toLocaleString("ru-RU")} {p.currency}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {p.unitellerCardMask ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <PaymentStatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
