"use client";

/**
 * Фильтр + поиск для `/admin/products` (P6-T3). При submit меняет
 * querystring через `useRouter().push()`. Сброс page на 1 при любом
 * изменении (стандартный pattern P5-T1).
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ACTIVE_META, StatusOption } from "@/components/admin/status-meta";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/lib/use-debounce";
import { useFilterUrl } from "@/lib/use-filter-url";
import type { AdminProductListQuery } from "@/server/admin-products";

export function ProductsListFilters({ query }: { query: AdminProductListQuery }): JSX.Element {
  const t = useTranslations("admin.products.list");
  const { applyParams, isPending } = useFilterUrl();
  const [q, setQ] = useState(query.q ?? "");

  const push = applyParams;

  const buildParams = (overrides: Partial<{ q: string; active: string }> = {}): URLSearchParams => {
    const params = new URLSearchParams();
    const qVal = overrides.q ?? q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const active = overrides.active ?? (query.active === null ? "" : String(query.active));
    if (active === "true" || active === "false") params.set("active", active);
    return params;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    push(buildParams());
  };

  const onActiveChange = (v: string): void => {
    push(buildParams({ active: v === "__all__" ? "" : v }));
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
      className="flex flex-wrap items-center gap-2"
      data-testid="admin-products-filters"
    >
      <Input
        name="q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchPlaceholder")}
        disabled={isPending}
        className="w-72"
        data-testid="admin-products-search-input"
      />
      <Select
        value={query.active === null ? "__all__" : String(query.active)}
        onValueChange={onActiveChange}
        disabled={isPending}
      >
        <SelectTrigger data-testid="admin-products-active-filter" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">
            <StatusOption muted label={t("filterAll")} />
          </SelectItem>
          <SelectItem value="true">
            <StatusOption
              dot={ACTIVE_META["true"]?.dot}
              icon={ACTIVE_META["true"]?.icon}
              label={t("filterActive")}
            />
          </SelectItem>
          <SelectItem value="false">
            <StatusOption
              dot={ACTIVE_META["false"]?.dot}
              icon={ACTIVE_META["false"]?.icon}
              label={t("filterInactive")}
            />
          </SelectItem>
        </SelectContent>
      </Select>
    </form>
  );
}
