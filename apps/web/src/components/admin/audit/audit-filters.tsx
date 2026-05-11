"use client";

/**
 * Фильтр для `/admin/audit` (P6-T8 follow-up). Querystring
 * `?group=&q=&from=&to=&page=`.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AUDIT_GROUP_META, StatusOption } from "@/components/admin/status-meta";
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
import type { AdminAuditQuery } from "@/server/admin-audit";

const GROUPS = ["user", "order", "refund", "recheck", "cancel", "webhook"] as const;

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function AuditFilters({ query }: { query: AdminAuditQuery }): JSX.Element {
  const t = useTranslations("admin.audit");
  const { applyParams, clearParams, isPending } = useFilterUrl();
  const [q, setQ] = useState(query.q ?? "");
  const [from, setFrom] = useState(toDateInputValue(query.from));
  const [to, setTo] = useState(toDateInputValue(query.to));

  const buildParams = (overrides: Partial<{ group: string; q: string }> = {}): URLSearchParams => {
    const params = new URLSearchParams();
    const qVal = overrides.q ?? q;
    if (qVal.trim() !== "") params.set("q", qVal.trim());
    const group = overrides.group ?? query.group ?? "";
    if (group) params.set("group", group);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  };

  const push = applyParams;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    push(buildParams());
  };

  const onGroupChange = (v: string): void => {
    push(buildParams({ group: v === "__all__" ? "" : v }));
  };

  const hasFilters = Boolean(q || query.group || from || to);
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
      data-testid="admin-audit-filters"
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("filterGroup")}</Label>
        <Select value={query.group ?? "__all__"} onValueChange={onGroupChange} disabled={isPending}>
          <SelectTrigger data-testid="admin-audit-group-filter" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              <StatusOption muted label={t("filterAllGroups")} />
            </SelectItem>
            {GROUPS.map((g) => {
              const meta = AUDIT_GROUP_META[g];
              return (
                <SelectItem key={g} value={g}>
                  <StatusOption dot={meta?.dot} icon={meta?.icon} label={t(`groups.${g}`)} />
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-q" className="text-xs text-muted-foreground">
          {t("searchPlaceholder")}
        </Label>
        <Input
          id="audit-q"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          disabled={isPending}
          className="w-72"
          data-testid="admin-audit-q"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-range" className="text-xs text-muted-foreground">
          {t("dateRange")}
        </Label>
        <DateRangePicker
          id="audit-range"
          from={from}
          to={to}
          onChange={({ from: f, to: t2 }) => {
            setFrom(f);
            setTo(t2);
          }}
          disabled={isPending}
          placeholder={t("dateRange")}
          className="w-[280px]"
          testId="admin-audit-range"
        />
      </div>
      <Button type="submit" disabled={isPending} data-testid="admin-audit-apply">
        {t("apply")}
      </Button>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={isPending}
          data-testid="admin-audit-reset"
        >
          {t("reset")}
        </Button>
      ) : null}
    </form>
  );
}
