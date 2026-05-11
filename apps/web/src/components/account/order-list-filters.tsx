"use client";

/**
 * `<OrderListFilters>` (P5-T1) — клиентский Select по `Order.status`.
 * Реагирует на change через `useRouter().push()` с обновлением querystring.
 * Сбрасывает `page` к 1 при смене фильтра — чтобы юзер не оказался на 5-й
 * странице фильтра, где уже нет данных.
 */

import { useTranslations } from "next-intl";
import { type ChangeEvent } from "react";

import { useFilterUrl } from "@/lib/use-filter-url";
import { ORDER_STATUSES } from "@/server/account-orders";

export function OrderListFilters({
  current,
  className,
}: {
  current: string | null;
  className?: string;
}): JSX.Element {
  const t = useTranslations("account.orders.list.filters");
  const tStatus = useTranslations("account.orders.statuses");
  const { applyParams, isPending } = useFilterUrl();

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    applyParams(params);
  };

  return (
    <label className={`flex items-center gap-2 text-sm ${className ?? ""}`}>
      <span className="text-muted-foreground">{t("label")}:</span>
      <select
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
        value={current ?? ""}
        onChange={onChange}
        disabled={isPending}
      >
        <option value="">{t("all")}</option>
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {tStatus(s)}
          </option>
        ))}
      </select>
    </label>
  );
}
