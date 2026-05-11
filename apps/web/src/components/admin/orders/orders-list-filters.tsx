"use client";

/**
 * Фильтр + поиск для `/admin/orders` (P6-T5). Querystring
 * `?q=&status=&from=&to=&page=`. Любое изменение сбрасывает page на 1
 * (стандартный pattern P5-T1/P6-T3). Date range закрывает open question
 * P6-T5.d — admin может ограничить выдачу по `Order.createdAt`.
 */

import type { OrderStatus } from "@bigmax/db";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ORDER_STATUS_META, StatusOption } from "@/components/admin/status-meta";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import type { AdminOrderListQuery } from "@/server/admin-orders";

const STATUSES: ReadonlyArray<OrderStatus> = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function OrdersListFilters({ query }: { query: AdminOrderListQuery }): JSX.Element {
  const t = useTranslations("admin.orders.list");
  const tStatus = useTranslations("admin.orders.statuses");
  const { applyParams, clearParams, isPending } = useFilterUrl();
  const [q, setQ] = useState(query.q ?? "");
  const [from, setFrom] = useState<string>(toDateInputValue(query.from));
  const [to, setTo] = useState<string>(toDateInputValue(query.to));

  const buildParams = (overrides: Partial<{ status: string; q: string }> = {}): URLSearchParams => {
    const params = new URLSearchParams();
    const qVal = overrides.q ?? q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const status = overrides.status ?? query.status ?? "";
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
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

  const hasFilters = Boolean(q || query.status || from || to);
  const onReset = (): void => {
    setQ("");
    setFrom("");
    setTo("");
    clearParams();
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
      data-testid="admin-orders-filters"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-orders-q" className="text-xs text-muted-foreground">
          {t("searchPlaceholder")}
        </Label>
        <Input
          id="admin-orders-q"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          disabled={isPending}
          className="w-72"
          data-testid="admin-orders-search-input"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("filterAll")}</Label>
        <Select
          value={query.status ?? "__all__"}
          onValueChange={onStatusChange}
          disabled={isPending}
        >
          <SelectTrigger data-testid="admin-orders-status-filter" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              <StatusOption muted label={t("filterAll")} />
            </SelectItem>
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
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-orders-range" className="text-xs text-muted-foreground">
          {t("dateRange")}
        </Label>
        <DateRangePicker
          id="admin-orders-range"
          from={from}
          to={to}
          onChange={({ from: f, to: t2 }) => {
            setFrom(f);
            setTo(t2);
          }}
          disabled={isPending}
          placeholder={t("dateRange")}
          className="w-[280px]"
          testId="admin-orders-range-filter"
        />
      </div>
      <Button type="submit" disabled={isPending} data-testid="admin-orders-apply">
        {t("apply")}
      </Button>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={isPending}
          data-testid="admin-orders-reset"
        >
          {t("reset")}
        </Button>
      ) : null}
    </form>
  );
}
