/**
 * `/admin/stock` — список остатков по филиалам (P6-T7).
 *
 * SSR с querystring `?branchId=&q=&lowStock=&page=N`. Default branchId =
 * первый активный филиал. Список per-branch — admin переключает branch'и
 * через select. lowStock-фильтр показывает только items с
 * `available <= LOW_STOCK_THRESHOLD` (5).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale, type Locale } from "@bigmax/shared-types";
import { formatDistanceToNowStrict } from "date-fns";
import { enUS, ru, uz } from "date-fns/locale";
import { Boxes, History, Pencil, Upload } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StockAdjustDialog } from "@/components/admin/stock/stock-adjust-dialog";
import { StockBulkAdjustDialog } from "@/components/admin/stock/stock-bulk-adjust-dialog";
import { StockListFilters } from "@/components/admin/stock/stock-list-filters";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  getAdminStock,
  getAdminStockBranches,
  parseAdminStockListQuery,
} from "@/server/admin-stock";

const DATE_FNS_LOCALES = { ru, uz, en: enUS } as const;

type StockHealth = "ok" | "low" | "out";

function stockHealth(available: number, isLow: boolean): StockHealth {
  if (available <= 0) return "out";
  if (isLow) return "low";
  return "ok";
}

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdminStockPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const branches = await getAdminStockBranches();
  if (branches.length === 0) {
    return <NoBranches />;
  }

  const query = parseAdminStockListQuery(searchParams);
  // Если branchId не указан — редирект на дефолтный (первый активный).
  if (!query.branchId) {
    const qs = new URLSearchParams();
    qs.set("branchId", branches[0]!.id);
    if (query.q) qs.set("q", query.q);
    for (const s of query.statuses) qs.append("status", s);
    if (query.availableMin !== null) qs.set("minAvailable", String(query.availableMin));
    if (query.availableMax !== null) qs.set("maxAvailable", String(query.availableMax));
    if (query.sort !== "available_asc") qs.set("sort", query.sort);
    redirect(`/${params.locale}/admin/stock?${qs.toString()}`);
  }

  const result = await getAdminStock(query);
  const t = await getTranslations("admin.stock.list");
  const tAdjust = await getTranslations("admin.stock.adjust");
  const currentBranch = branches.find((b) => b.id === query.branchId);

  return (
    <div className="space-y-6" data-testid="admin-stock">
      <AdminBreadcrumbs items={[{ labelKey: "stock" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {currentBranch ? (
              <StockBulkAdjustDialog
                branchId={currentBranch.id}
                branchName={currentBranch.nameRu}
              />
            ) : null}
            <Button asChild variant="outline">
              <Link href="/admin/stock/import" data-testid="admin-stock-import-link">
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                {t("import")}
              </Link>
            </Button>
          </>
        }
      />

      <StockListFilters query={query} branches={branches} />

      <p className="text-xs text-muted-foreground">{t("summary", { count: result.total })}</p>

      {result.items.length === 0 ? (
        <AdminEmptyState icon={Boxes} title={t("empty")} testId="admin-stock-empty" />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table data-testid="admin-stock-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[55%]">{t("table.item")}</TableHead>
                <TableHead className="text-right">{t("table.stock")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("table.updatedAt")}</TableHead>
                <TableHead className="text-right">{t("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((s) => {
                const health = stockHealth(s.available, s.isLow);
                return (
                  <TableRow
                    key={s.id}
                    className={cn(
                      health === "low" && "bg-amber-50/40 hover:bg-amber-50 dark:bg-amber-950/10",
                      health === "out" && "bg-red-50/40 hover:bg-red-50 dark:bg-red-950/10",
                    )}
                    data-testid="admin-stock-row"
                    data-stock-id={s.id}
                    data-low={s.isLow ? "true" : "false"}
                    data-health={health}
                  >
                    <TableCell className="py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium leading-tight">
                          <Highlight text={s.productNameRu} query={query.q} />
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="font-mono text-[11px]">
                            <Highlight text={s.sku} query={query.q} />
                          </span>
                          {s.color ? <span>· {s.color}</span> : null}
                          {s.size ? <span>· {s.size}</span> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top" data-testid="admin-stock-available">
                      <div className="inline-flex items-center justify-end gap-2 leading-tight">
                        <HealthDot health={health} />
                        <span
                          className={cn(
                            "font-mono text-xl font-semibold tabular-nums",
                            health === "low" && "text-amber-700 dark:text-amber-400",
                            health === "out" && "text-red-700 dark:text-red-400",
                          )}
                        >
                          {s.available}
                        </span>
                        {s.reserved > 0 ? (
                          <span className="text-[11px] text-muted-foreground">/ {s.quantity}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden align-top text-xs text-muted-foreground lg:table-cell">
                      <RelativeTime value={s.updatedAt} locale={params.locale as Locale} />
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <div className="flex justify-end gap-0.5">
                        <StockAdjustDialog
                          stockId={s.id}
                          sku={s.sku}
                          productNameRu={s.productNameRu}
                          currentQuantity={s.quantity}
                          trigger={
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={tAdjust("trigger")}
                              title={tAdjust("trigger")}
                              data-testid="stock-adjust-trigger"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          }
                        />
                        <Button
                          asChild
                          size="icon"
                          variant="ghost"
                          aria-label={t("table.historyAction")}
                          title={t("table.historyAction")}
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Link
                            href={`/admin/stock/${s.id}/history`}
                            data-testid="admin-stock-history-link"
                          >
                            <History className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {result.pageCount > 1 ? <Pagination result={result} query={query} /> : null}
    </div>
  );
}

function HealthDot({ health }: { health: StockHealth }): JSX.Element {
  const cls =
    health === "out" ? "bg-red-500" : health === "low" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span
      aria-hidden
      data-testid={`admin-stock-health-${health}`}
      className={cn("h-2 w-2 shrink-0 rounded-full", cls)}
    />
  );
}

function RelativeTime({ value, locale }: { value: Date; locale: Locale }): JSX.Element {
  const dateLocale = DATE_FNS_LOCALES[locale];
  const rel = formatDistanceToNowStrict(value, { addSuffix: true, locale: dateLocale });
  return (
    <time dateTime={value.toISOString()} title={value.toISOString().slice(0, 16).replace("T", " ")}>
      {rel}
    </time>
  );
}

async function NoBranches(): Promise<JSX.Element> {
  const t = await getTranslations("admin.stock.list");
  return (
    <div className="space-y-4" data-testid="admin-stock-no-branches">
      <AdminBreadcrumbs items={[{ labelKey: "stock" }]} />
      <h2 className="text-2xl font-semibold">{t("title")}</h2>
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("noBranches")}
      </p>
    </div>
  );
}

async function Pagination({
  result,
  query,
}: {
  result: { page: number; pageCount: number };
  query: ReturnType<typeof parseAdminStockListQuery>;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.branchId) params.set("branchId", query.branchId);
    if (query.q) params.set("q", query.q);
    for (const s of query.statuses) params.append("status", s);
    if (query.availableMin !== null) params.set("minAvailable", String(query.availableMin));
    if (query.availableMax !== null) params.set("maxAvailable", String(query.availableMax));
    if (query.sort !== "available_asc") params.set("sort", query.sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/stock?${qs}` : `/admin/stock`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-stock-pagination"
    >
      {result.page > 1 ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page - 1)}>
          ← {t("prev")}
        </Link>
      ) : (
        <span className="text-muted-foreground">← {t("prev")}</span>
      )}
      <span className="text-muted-foreground">
        {t("page", { page: result.page, total: result.pageCount })}
      </span>
      {result.page < result.pageCount ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page + 1)}>
          {t("next")} →
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("next")} →</span>
      )}
    </nav>
  );
}
