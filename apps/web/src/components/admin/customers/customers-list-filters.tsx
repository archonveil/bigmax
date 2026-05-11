"use client";

/**
 * Фильтр для `/admin/customers` (P6-T8). Querystring `?q=&role=&page=`.
 * Pattern такой же как `<OrdersListFilters>` / `<PaymentsListFilters>`.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CUSTOMER_ROLE_META, StatusOption } from "@/components/admin/status-meta";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/lib/use-debounce";
import { useFilterUrl } from "@/lib/use-filter-url";
import type { AdminCustomerListQuery } from "@/server/admin-customers";

const ROLES = ["customer", "manager", "admin"] as const;

export function CustomersListFilters({ query }: { query: AdminCustomerListQuery }): JSX.Element {
  const t = useTranslations("admin.customers.list");
  const tRole = useTranslations("admin.customers.roles");
  const { applyParams, isPending } = useFilterUrl();
  const [q, setQ] = useState(query.q ?? "");

  const buildParams = (overrides: Partial<{ role: string; q: string }> = {}): URLSearchParams => {
    const params = new URLSearchParams();
    const qVal = overrides.q ?? q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const role = overrides.role ?? query.role ?? "";
    if (role) params.set("role", role);
    return params;
  };

  const push = applyParams;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    push(buildParams());
  };

  const onRoleChange = (v: string): void => {
    push(buildParams({ role: v === "__all__" ? "" : v }));
  };

  // 300ms debounce: push на изменение `q` через 300мс после последнего keystroke.
  const debouncedQ = useDebounce(q, 300);
  const lastPushedQRef = useRef(query.q ?? "");
  useEffect(() => {
    const next = debouncedQ.trim();
    if (next === lastPushedQRef.current) return;
    lastPushedQRef.current = next;
    push(buildParams({ q: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3"
      data-testid="admin-customers-filters"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-customers-q" className="text-xs text-muted-foreground">
          {t("searchPlaceholder")}
        </Label>
        <Input
          id="admin-customers-q"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          disabled={isPending}
          className="w-72"
          data-testid="admin-customers-search-input"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("filterRole")}</Label>
        <Select value={query.role ?? "__all__"} onValueChange={onRoleChange} disabled={isPending}>
          <SelectTrigger data-testid="admin-customers-role-filter" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              <StatusOption muted label={t("filterAllRoles")} />
            </SelectItem>
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
    </form>
  );
}
