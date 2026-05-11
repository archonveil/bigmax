"use client";

/**
 * Фильтр для `/admin/payments` (P6-T6). Querystring
 * `?q=&status=&provider=&page=`. Pattern скопирован из
 * `<OrdersListFilters>` с минимальными отличиями (provider select).
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  PAYMENT_PROVIDER_META,
  PAYMENT_STATUS_META,
  StatusOption,
} from "@/components/admin/status-meta";
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
import type { AdminPaymentListQuery } from "@/server/admin-payments";

const STATUSES = [
  "pending",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

const PROVIDERS = ["uniteller", "cod"] as const;

export function PaymentsListFilters({ query }: { query: AdminPaymentListQuery }): JSX.Element {
  const t = useTranslations("admin.payments.list");
  const tStatus = useTranslations("admin.payments.statuses");
  const tProvider = useTranslations("admin.payments.providers");
  const { applyParams, isPending } = useFilterUrl();
  const [q, setQ] = useState(query.q ?? "");

  const buildParams = (
    overrides: Partial<{ status: string; provider: string; q: string }> = {},
  ): URLSearchParams => {
    const params = new URLSearchParams();
    const qVal = overrides.q ?? q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const status = overrides.status ?? query.status ?? "";
    if (status) params.set("status", status);
    const provider = overrides.provider ?? query.provider ?? "";
    if (provider) params.set("provider", provider);
    return params;
  };

  const push = applyParams;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    push(buildParams());
  };

  const onStatusChange = (v: string): void => {
    push(buildParams({ status: v === "__all__" ? "" : v }));
  };

  const onProviderChange = (v: string): void => {
    push(buildParams({ provider: v === "__all__" ? "" : v }));
  };

  // 300ms debounce: push на изменение `q` через 300мс после остановки набора.
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
      data-testid="admin-payments-filters"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-payments-q" className="text-xs text-muted-foreground">
          {t("searchPlaceholder")}
        </Label>
        <Input
          id="admin-payments-q"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          disabled={isPending}
          className="w-72"
          data-testid="admin-payments-search-input"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("filterStatus")}</Label>
        <Select
          value={query.status ?? "__all__"}
          onValueChange={onStatusChange}
          disabled={isPending}
        >
          <SelectTrigger data-testid="admin-payments-status-filter" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              <StatusOption muted label={t("filterAllStatus")} />
            </SelectItem>
            {STATUSES.map((s) => {
              const meta = PAYMENT_STATUS_META[s];
              return (
                <SelectItem key={s} value={s}>
                  <StatusOption dot={meta?.dot} icon={meta?.icon} label={tStatus(s)} />
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("filterProvider")}</Label>
        <Select
          value={query.provider ?? "__all__"}
          onValueChange={onProviderChange}
          disabled={isPending}
        >
          <SelectTrigger data-testid="admin-payments-provider-filter" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              <StatusOption muted label={t("filterAllProvider")} />
            </SelectItem>
            {PROVIDERS.map((p) => {
              const meta = PAYMENT_PROVIDER_META[p];
              return (
                <SelectItem key={p} value={p}>
                  <StatusOption dot={meta?.dot} icon={meta?.icon} label={tProvider(p)} />
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </form>
  );
}
