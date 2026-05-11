"use client";

/**
 * Advanced фильтр для `/admin/stock`. Querystring:
 *   `?branchId=&q=&status=ok&status=low&status=out&minAvailable=&maxAvailable=&sort=&page=`
 *
 * Состав:
 *  - Branch select (обязательный, переключение per-branch).
 *  - Search debounced 300ms (по SKU + product nameRu).
 *  - Status-чипы (ok / low / out, multi-select toggle с цветным индикатором).
 *  - Available range (min / max integer inputs, applied on blur).
 *  - Sort dropdown (available asc/desc, updated asc/desc, sku asc).
 *  - Active chip strip с individual ×-removal + Reset all кнопка.
 */

import { AlertTriangle, ArrowDownUp, CheckCircle2, PackageX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  STOCK_HEALTHS,
  STOCK_SORTS,
  type AdminBranchOption,
  type AdminStockListQuery,
  type StockHealth,
  type StockSort,
} from "@/server/admin-stock";

const STATUS_META: Record<
  StockHealth,
  { Icon: typeof CheckCircle2; activeCls: string; idleCls: string }
> = {
  ok: {
    Icon: CheckCircle2,
    activeCls:
      "border-emerald-300 bg-emerald-100 text-emerald-800 ring-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    idleCls: "hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
  },
  low: {
    Icon: AlertTriangle,
    activeCls:
      "border-amber-300 bg-amber-100 text-amber-800 ring-amber-200 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    idleCls: "hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30",
  },
  out: {
    Icon: PackageX,
    activeCls:
      "border-red-300 bg-red-100 text-red-800 ring-red-200 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
    idleCls: "hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30",
  },
};

interface FilterDraft {
  q: string;
  statuses: StockHealth[];
  availableMin: string;
  availableMax: string;
  sort: StockSort;
}

function fromQuery(query: AdminStockListQuery): FilterDraft {
  return {
    q: query.q ?? "",
    statuses: query.statuses,
    availableMin: query.availableMin !== null ? String(query.availableMin) : "",
    availableMax: query.availableMax !== null ? String(query.availableMax) : "",
    sort: query.sort,
  };
}

export function StockListFilters({
  query,
  branches,
}: {
  query: AdminStockListQuery;
  branches: AdminBranchOption[];
}): JSX.Element {
  const t = useTranslations("admin.stock.list");
  const { applyParams, isPending } = useFilterUrl();
  const [draft, setDraft] = useState<FilterDraft>(() => fromQuery(query));

  // Re-sync local draft when URL changes externally (e.g. browser back).
  const querySig = `${query.q ?? ""}|${query.statuses.join(",")}|${query.availableMin ?? ""}|${query.availableMax ?? ""}|${query.sort}`;
  useEffect(() => {
    setDraft(fromQuery(query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySig]);

  const buildParams = (
    overrides: Partial<FilterDraft & { branchId: string }> = {},
  ): URLSearchParams => {
    const params = new URLSearchParams();
    const branchId = overrides.branchId ?? query.branchId ?? "";
    if (branchId) params.set("branchId", branchId);
    const qVal = overrides.q ?? draft.q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const statuses = overrides.statuses ?? draft.statuses;
    for (const s of statuses) params.append("status", s);
    const min = overrides.availableMin ?? draft.availableMin;
    if (min.trim() !== "") params.set("minAvailable", min.trim());
    const max = overrides.availableMax ?? draft.availableMax;
    if (max.trim() !== "") params.set("maxAvailable", max.trim());
    const sort = overrides.sort ?? draft.sort;
    if (sort !== "available_asc") params.set("sort", sort);
    return params;
  };

  const push = applyParams;

  const onBranchChange = (v: string): void => push(buildParams({ branchId: v }));

  const toggleStatus = (s: StockHealth): void => {
    const next = draft.statuses.includes(s)
      ? draft.statuses.filter((x) => x !== s)
      : [...draft.statuses, s];
    setDraft((d) => ({ ...d, statuses: next }));
    push(buildParams({ statuses: next }));
  };

  const onSortChange = (v: string): void => {
    const sort = (STOCK_SORTS as readonly string[]).includes(v)
      ? (v as StockSort)
      : "available_asc";
    setDraft((d) => ({ ...d, sort }));
    push(buildParams({ sort }));
  };

  const commitMin = (): void => push(buildParams());
  const commitMax = (): void => push(buildParams());

  const onRangeKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      push(buildParams());
    }
  };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    push(buildParams());
  };

  // 300ms debounce: push на изменение `q` через 300мс после остановки набора.
  const debouncedQ = useDebounce(draft.q, 300);
  const lastPushedQRef = useRef(query.q ?? "");
  useEffect(() => {
    const next = debouncedQ.trim();
    if (next === lastPushedQRef.current) return;
    lastPushedQRef.current = next;
    push(buildParams({ q: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // ---- Active filter chips ----
  const chips: Array<{ id: string; label: string; onRemove: () => void }> = [];
  if (draft.q.trim() !== "") {
    chips.push({
      id: "q",
      label: t("activeChip.q", { value: draft.q.trim() }),
      onRemove: () => {
        setDraft((d) => ({ ...d, q: "" }));
        push(buildParams({ q: "" }));
      },
    });
  }
  for (const s of draft.statuses) {
    chips.push({
      id: `status-${s}`,
      label: t(`status.${s}`),
      onRemove: () => toggleStatus(s),
    });
  }
  if (draft.availableMin.trim() !== "" || draft.availableMax.trim() !== "") {
    const min = draft.availableMin.trim();
    const max = draft.availableMax.trim();
    const label =
      min !== "" && max !== ""
        ? t("activeChip.range", { min, max })
        : min !== ""
          ? t("activeChip.rangeMin", { min })
          : t("activeChip.rangeMax", { max });
    chips.push({
      id: "range",
      label,
      onRemove: () => {
        setDraft((d) => ({ ...d, availableMin: "", availableMax: "" }));
        push(buildParams({ availableMin: "", availableMax: "" }));
      },
    });
  }
  if (draft.sort !== "available_asc") {
    chips.push({
      id: "sort",
      label: t("activeChip.sort", { value: t(`sortOptions.${draft.sort}`) }),
      onRemove: () => onSortChange("available_asc"),
    });
  }
  const hasActive = chips.length > 0;
  const reset = (): void => {
    setDraft({ q: "", statuses: [], availableMin: "", availableMax: "", sort: "available_asc" });
    const params = new URLSearchParams();
    if (query.branchId) params.set("branchId", query.branchId);
    push(params);
  };

  return (
    <div className="space-y-3" data-testid="admin-stock-filters">
      {/* Top row: branch + search + sort. */}
      <form onSubmit={onSearchSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("branch")}</Label>
          <Select value={query.branchId ?? ""} onValueChange={onBranchChange} disabled={isPending}>
            <SelectTrigger data-testid="admin-stock-branch-filter" className="min-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.nameRu}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-stock-q" className="text-xs text-muted-foreground">
            {t("searchPlaceholder")}
          </Label>
          <Input
            id="admin-stock-q"
            name="q"
            type="search"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder={t("searchPlaceholder")}
            disabled={isPending}
            className="w-72"
            data-testid="admin-stock-search-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowDownUp className="h-3 w-3" aria-hidden />
            {t("sortLabel")}
          </Label>
          <Select value={draft.sort} onValueChange={onSortChange} disabled={isPending}>
            <SelectTrigger className="min-w-[200px]" data-testid="admin-stock-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`sortOptions.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </form>

      {/* Status chips + available range. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("statusLabel")}</Label>
          <div
            role="group"
            aria-label={t("statusLabel")}
            className="flex flex-wrap gap-1.5"
            data-testid="admin-stock-status-chips"
          >
            {STOCK_HEALTHS.map((s) => {
              const active = draft.statuses.includes(s);
              const meta = STATUS_META[s];
              const Icon = meta.Icon;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStatus(s)}
                  disabled={isPending}
                  data-testid={`admin-stock-status-chip-${s}`}
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? cn("ring-1 ring-inset", meta.activeCls)
                      : cn("border-input bg-background text-muted-foreground", meta.idleCls),
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {t(`status.${s}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">{t("availableRange")}</Label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0"
              value={draft.availableMin}
              onChange={(e) => setDraft((d) => ({ ...d, availableMin: e.target.value }))}
              onBlur={commitMin}
              onKeyDown={onRangeKey}
              disabled={isPending}
              placeholder={t("availableMinPlaceholder")}
              aria-label={t("availableMinPlaceholder")}
              className="h-9 w-[110px]"
              data-testid="admin-stock-available-min"
            />
            <span aria-hidden className="text-xs text-muted-foreground">
              —
            </span>
            <Input
              type="number"
              min="0"
              value={draft.availableMax}
              onChange={(e) => setDraft((d) => ({ ...d, availableMax: e.target.value }))}
              onBlur={commitMax}
              onKeyDown={onRangeKey}
              disabled={isPending}
              placeholder={t("availableMaxPlaceholder")}
              aria-label={t("availableMaxPlaceholder")}
              className="h-9 w-[110px]"
              data-testid="admin-stock-available-max"
            />
          </div>
        </div>
      </div>

      {/* Active filter chips strip + Reset. */}
      {hasActive ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="admin-stock-active-chips">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={c.onRemove}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground transition hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`admin-stock-active-chip-${c.id}`}
            >
              <span>{c.label}</span>
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={reset}
            disabled={isPending}
            data-testid="admin-stock-reset"
            className="h-7 text-xs"
          >
            {t("resetAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
