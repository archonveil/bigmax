"use client";

/**
 * `<ProductStockMatrix>` — упрощённая inline-секция управления остатками
 * на странице продукта. Принципы:
 *  - Один заметный номер на ячейку (доступно), цвет = статус.
 *  - Один subtle подзаголовок (`из {qty}` если резерв > 0, иначе hidden).
 *  - Один лёгкий цветной dot вместо громоздких pill'ов.
 *  - Одна короткая summary-строка вместо 4-х метрик-карточек.
 *  - Ячейка кликабельна → открывает Adjust-диалог (вместо отдельной кнопки
 *    в каждой ячейке — меньше визуального шума).
 *
 * Filter chips остаются (Все / Заканчивается / Нет в наличии) — но
 * smaller / quieter.
 */

import type { Locale } from "@bigmax/shared-types";
import { formatDistanceToNowStrict } from "date-fns";
import { enUS, ru, uz } from "date-fns/locale";
import { Boxes, ChevronDown, History as HistoryIcon, Pencil, Plus, Store } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdminVariant } from "@/server/admin-products";
import type {
  AdminBranchOption,
  AdminProductStockCell,
  AdminProductStockMatrix as MatrixData,
} from "@/server/admin-stock";

const StockAdjustDialog = dynamic(
  () => import("@/components/admin/stock/stock-adjust-dialog").then((m) => m.StockAdjustDialog),
  { ssr: false },
);

const StockCreateDialog = dynamic(
  () => import("@/components/admin/stock/stock-create-dialog").then((m) => m.StockCreateDialog),
  { ssr: false },
);

const DATE_FNS_LOCALES = { ru, uz, en: enUS } as const;

type Health = "ok" | "low" | "out";

function healthOf(cell: AdminProductStockCell | undefined): Health {
  if (!cell || cell.isOut) return "out";
  if (cell.isLow) return "low";
  return "ok";
}

interface Props {
  productNameRu: string;
  variants: AdminVariant[];
  matrix: MatrixData;
  locale: Locale;
  colorOptions?: readonly AttributeOption[];
  /** Слот для секции истории stock-операций. Скрыт по умолчанию,
   *  раскрывается клик по кнопке в header'е. */
  history?: React.ReactNode;
}

type StatusFilter = "all" | "low" | "out";

export function ProductStockMatrix({
  productNameRu,
  variants,
  matrix,
  locale,
  colorOptions = [],
  history,
}: Props): JSX.Element {
  const t = useTranslations("admin.products.stock");
  const tHistory = useTranslations("admin.products.stockHistory");
  const tStatus = useTranslations("admin.stock.list.status");
  const tAdjust = useTranslations("admin.stock.adjust");
  const dateLocale = DATE_FNS_LOCALES[locale];
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [historyOpen, setHistoryOpen] = useState(false);

  const summary = useMemo(() => {
    let totalAvailable = 0;
    let lowCount = 0;
    let outCount = 0;
    for (const v of variants) {
      const row = matrix.byVariant[v.id] ?? {};
      for (const b of matrix.branches) {
        const cell = row[b.id];
        const h = healthOf(cell);
        if (cell) totalAvailable += cell.available;
        if (h === "low") lowCount += 1;
        else if (h === "out") outCount += 1;
      }
    }
    return { totalAvailable, lowCount, outCount };
  }, [variants, matrix]);

  const matchesFilter = (cell: AdminProductStockCell | undefined): boolean => {
    if (filter === "all") return true;
    const h = healthOf(cell);
    return h === filter;
  };

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="product-stock-matrix">
      {/* ---- Header: title + concise summary + filter chips + history toggle ---- */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Boxes className="h-4 w-4" aria-hidden />
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("summary", {
              total: summary.totalAvailable,
              low: summary.lowCount,
              out: summary.outCount,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {(["all", "low", "out"] as const).map((f) => {
              const active = filter === f;
              const count = f === "low" ? summary.lowCount : f === "out" ? summary.outCount : null;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={active}
                  data-testid={`product-stock-filter-${f}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-foreground/30 bg-foreground/5 text-foreground"
                      : "border-input text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f !== "all" ? <HealthDot health={f} /> : null}
                  <span>{f === "all" ? t("filterAll") : tStatus(f)}</span>
                  {count !== null && count > 0 ? (
                    <span className="text-[10px] text-muted-foreground">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {history ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((s) => !s)}
              aria-expanded={historyOpen}
              aria-controls="product-stock-history-panel"
              data-testid="product-stock-history-toggle"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                historyOpen
                  ? "border-primary/40 bg-primary/5 text-foreground"
                  : "border-input text-muted-foreground hover:bg-muted",
              )}
            >
              <HistoryIcon className="h-3.5 w-3.5" aria-hidden />
              {historyOpen ? tHistory("hideToggle") : tHistory("showToggle")}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", historyOpen && "rotate-180")}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
      </header>

      {variants.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
          data-testid="product-stock-empty"
        >
          {t("emptyVariants")}
        </p>
      ) : (
        <div className="space-y-2">
          {variants.map((v) => {
            const row = matrix.byVariant[v.id] ?? {};
            const visibleBranches = matrix.branches.filter((b) => matchesFilter(row[b.id]));
            if (visibleBranches.length === 0) return null;
            const colorOpt = resolveColorOption(v.color, colorOptions);
            const colorLabel = colorOpt ? pickOptionLabel(colorOpt, locale) : v.color;
            return (
              <article
                key={v.id}
                className="overflow-hidden rounded-md border"
                data-testid="product-stock-variant"
                data-variant-id={v.id}
              >
                {/* Variant header — minimalist row */}
                <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
                  <span className="font-mono text-[11px] text-muted-foreground">{v.sku}</span>
                  {colorLabel ? (
                    <span className="inline-flex items-center gap-1.5">
                      {colorOpt?.color ? (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                          style={{ backgroundColor: colorOpt.color }}
                        />
                      ) : null}
                      <span className="font-medium text-foreground">{colorLabel}</span>
                    </span>
                  ) : null}
                  {v.size ? <span className="text-muted-foreground">· {v.size}</span> : null}
                </header>

                {/* Branches grid — 1/2/3 columns */}
                <div className="grid divide-x divide-y sm:grid-cols-2 lg:grid-cols-3">
                  {visibleBranches.map((b) => {
                    const cell = row[b.id];
                    const status = healthOf(cell);
                    return (
                      <BranchCell
                        key={b.id}
                        branch={b}
                        cell={cell}
                        status={status}
                        productNameRu={productNameRu}
                        variantId={v.id}
                        sku={v.sku}
                        dateLocale={dateLocale}
                        labelMissing={t("missing")}
                        labelEdit={tAdjust("trigger")}
                      />
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {history ? (
        <div
          id="product-stock-history-panel"
          hidden={!historyOpen}
          className="border-t pt-4"
          data-testid="product-stock-history-panel"
        >
          {history}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-branch cell — single bold number, subtle metadata, inline action.
// ---------------------------------------------------------------------------

function BranchCell({
  branch,
  cell,
  status,
  productNameRu,
  variantId,
  sku,
  dateLocale,
  labelMissing,
  labelEdit,
}: {
  branch: AdminBranchOption;
  cell: AdminProductStockCell | undefined;
  status: Health;
  productNameRu: string;
  variantId: string;
  sku: string;
  dateLocale: typeof ru;
  labelMissing: string;
  labelEdit: string;
}): JSX.Element {
  const tCreate = useTranslations("admin.stock.create");
  const [createOpen, setCreateOpen] = useState(false);
  const available = cell?.available ?? 0;
  const createTrigger = tCreate("trigger");
  const createHint = tCreate("triggerHint");
  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
      data-branch-id={branch.id}
      data-status={status}
    >
      {/* Big number + dot */}
      <div className="flex shrink-0 items-baseline gap-1.5">
        <HealthDot health={status} />
        <span
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums leading-none",
            status === "out" && "text-red-700 dark:text-red-400",
            status === "low" && "text-amber-700 dark:text-amber-400",
            status === "ok" && "text-foreground",
          )}
        >
          {available}
        </span>
        {cell && cell.reserved > 0 ? (
          <span className="text-[11px] text-muted-foreground">/ {cell.quantity}</span>
        ) : null}
      </div>

      {/* Branch name + relative time */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Store className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{branch.nameRu}</span>
        </p>
        <p
          className="text-[11px] text-muted-foreground/80"
          {...(cell ? { title: cell.updatedAt.toISOString() } : {})}
          suppressHydrationWarning
        >
          {cell
            ? formatDistanceToNowStrict(cell.updatedAt, {
                addSuffix: true,
                locale: dateLocale,
              })
            : labelMissing}
        </p>
      </div>

      {/* Inline action — icon-only ghost button. Adjust if row exists,
          otherwise opens StockCreateDialog to seed the (variant, branch) pair. */}
      {cell ? (
        <StockAdjustDialog
          stockId={cell.stockId}
          sku={sku}
          productNameRu={productNameRu}
          currentQuantity={cell.quantity}
          trigger={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={labelEdit}
              title={labelEdit}
              data-testid="stock-adjust-trigger"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
          }
        />
      ) : (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={createTrigger}
            title={createHint}
            onClick={() => setCreateOpen(true)}
            data-testid="stock-create-trigger"
            className="h-8 w-8 shrink-0 text-primary/80 hover:bg-primary/10 hover:text-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
          {createOpen ? (
            <StockCreateDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              variantId={variantId}
              branchId={branch.id}
              sku={sku}
              branchNameRu={branch.nameRu}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function HealthDot({ health }: { health: Health }): JSX.Element {
  const cls =
    health === "out" ? "bg-red-500" : health === "low" ? "bg-amber-500" : "bg-emerald-500";
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", cls)} />;
}
