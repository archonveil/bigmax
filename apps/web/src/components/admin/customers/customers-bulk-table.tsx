"use client";

/**
 * `<CustomersBulkTable>` (P6-T8 follow-up — closes (d) bulk role change).
 *
 * Wrap'ит таблицу клиентов: per-row checkbox + sticky bulk-bar. Bar
 * появляется при `selected.size > 0` с role select + reason input + Apply.
 * Submit бьёт `POST /api/admin/customers/bulk-role` → toast → `router.refresh()`.
 * Pattern такой же как `<OrdersBulkTable>` / `<PaymentsBulkTable>`.
 */

import { Link } from "@bigmax/i18n/navigation";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { CUSTOMER_ROLE_META, StatusOption } from "@/components/admin/status-meta";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminCustomerListItem } from "@/server/admin-customers";

const ROLES = ["customer", "manager", "admin"] as const;

const ROLE_TONE: Record<string, string> = {
  admin: "bg-rose-100 text-rose-800 ring-rose-200",
  manager: "bg-violet-100 text-violet-800 ring-violet-200",
  customer: "bg-slate-100 text-slate-700 ring-slate-200",
};

interface BulkResponse {
  ok: boolean;
  processed: string[];
  skipped: Array<{ userId: string; reason: string }>;
}

interface CustomersBulkTableProps {
  items: AdminCustomerListItem[];
  query?: string | null;
}

export function CustomersBulkTable({ items, query }: CustomersBulkTableProps): JSX.Element {
  const t = useTranslations("admin.customers.list");
  const tRole = useTranslations("admin.customers.roles");
  const tBulk = useTranslations("admin.customers.bulkRole");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<(typeof ROLES)[number]>("manager");
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
    if (
      !(await confirm({
        description: tBulk("confirm", { count: selected.size, role: tRole(target) }),
      }))
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/customers/bulk-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selected),
          role: target,
          reason: reason.trim(),
        }),
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
          className="sticky top-2 z-10 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-sm"
          data-testid="admin-customers-bulk-bar"
        >
          <span className="text-sm font-medium">{tBulk("selected", { count: selected.size })}</span>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{tBulk("targetLabel")}</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as (typeof ROLES)[number])}
              disabled={submitting}
            >
              <SelectTrigger data-testid="admin-customers-bulk-target" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => {
                  const meta = CUSTOMER_ROLE_META[r];
                  return (
                    <SelectItem key={r} value={r}>
                      <StatusOption dot={meta?.dot} icon={meta?.icon} label={tRole(r)} />
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col flex-1 min-w-[200px]">
            <Label htmlFor="bulk-role-reason" className="text-xs text-muted-foreground">
              {tBulk("reasonLabel")}
            </Label>
            <Input
              id="bulk-role-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              maxLength={500}
              placeholder={tBulk("reasonPlaceholder")}
              data-testid="admin-customers-bulk-reason"
            />
          </div>
          <Button
            onClick={() => void onApply()}
            disabled={submitting}
            data-testid="admin-customers-bulk-apply"
          >
            {submitting ? tBulk("applying") : tBulk("apply")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={submitting}
            data-testid="admin-customers-bulk-clear"
          >
            {tBulk("clear")}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="admin-customers-table">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  data-testid="admin-customers-select-all"
                  aria-label={tBulk("selectAll")}
                />
              </th>
              <th className="px-3 py-2 text-left">{t("table.name")}</th>
              <th className="px-3 py-2 text-left">{t("table.contact")}</th>
              <th className="px-3 py-2 text-left">{t("table.role")}</th>
              <th className="px-3 py-2 text-right">{t("table.orders")}</th>
              <th className="px-3 py-2 text-right">{t("table.loyalty")}</th>
              <th className="px-3 py-2 text-left">{t("table.createdAt")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((u) => (
              <tr
                key={u.id}
                className="hover:bg-accent/30"
                data-testid="admin-customers-row"
                data-user-id={u.id}
              >
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected.has(u.id)}
                    onCheckedChange={() => toggle(u.id)}
                    data-testid="admin-customers-row-checkbox"
                    aria-label={tBulk("selectRow")}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${u.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {u.name ? <Highlight text={u.name} query={query} /> : t("table.noName")}
                  </Link>
                  {u.isBlocked ? (
                    <span
                      className="ml-2 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
                      data-testid="admin-customers-blocked-tag"
                    >
                      {t("table.blocked")}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div>{u.email ? <Highlight text={u.email} query={query} /> : "—"}</div>
                  <div className="text-muted-foreground">
                    {u.phone ? <Highlight text={u.phone} query={query} /> : "—"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {(() => {
                    const RoleIcon = CUSTOMER_ROLE_META[u.role]?.icon;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          ROLE_TONE[u.role] ?? ROLE_TONE["customer"]
                        }`}
                      >
                        {RoleIcon ? <RoleIcon className="h-3 w-3" aria-hidden /> : null}
                        {tRole(u.role)}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right font-mono">{u.ordersCount}</td>
                <td className="px-3 py-2 text-right font-mono">{u.loyaltyPoints}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
