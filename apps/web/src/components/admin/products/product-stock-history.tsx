/**
 * `<ProductStockHistory>` — секция истории stock-операций по всем вариантам
 * выбранного продукта. Server-component (async) — fetcher тянется здесь же,
 * страница оборачивает в `<Suspense>` чтобы блок стримился независимо.
 *
 * Простой timeline-стиль: timestamp + variant-pill + branch + action chip
 * + delta (qty → qty', reserved → reserved') + reason + admin.
 *
 * Не клиентский компонент: `Adjust`-кнопок здесь нет (история append-only),
 * поэтому JS-bundle не растёт.
 */

import type { Locale } from "@bigmax/shared-types";
import { formatDistanceToNowStrict } from "date-fns";
import { enUS, ru, uz } from "date-fns/locale";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Equal,
  History as HistoryIcon,
  RotateCcw,
  Trash2,
  Truck,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import {
  getAdminProductStockHistory,
  type AdminProductStockHistoryItem,
} from "@/server/admin-stock";

const DATE_FNS_LOCALES = { ru, uz, en: enUS } as const;

interface ActionMeta {
  Icon: LucideIcon;
  toneCls: string;
}

const ACTION_META: Record<string, ActionMeta> = {
  set: {
    Icon: Equal,
    toneCls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  inc: {
    Icon: ArrowUp,
    toneCls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  dec: {
    Icon: ArrowDown,
    toneCls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  import: {
    Icon: Upload,
    toneCls: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  },
  create: {
    Icon: Archive,
    toneCls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  delete: {
    Icon: Trash2,
    toneCls: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  },
  ship: {
    Icon: Truck,
    toneCls: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  },
  reserve: {
    Icon: ArrowUp,
    toneCls: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  },
  release: {
    Icon: RotateCcw,
    toneCls: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  },
};

const FALLBACK_META: ActionMeta = {
  Icon: HistoryIcon,
  toneCls: "bg-muted text-muted-foreground",
};

export async function ProductStockHistory({
  productId,
  locale,
}: {
  productId: string;
  locale: Locale;
}): Promise<JSX.Element> {
  const [history, t] = await Promise.all([
    getAdminProductStockHistory(productId, 1),
    getTranslations("admin.products.stockHistory"),
  ]);
  const dateLocale = DATE_FNS_LOCALES[locale];

  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      data-testid="product-stock-history"
    >
      <header className="flex items-baseline justify-between gap-2 border-b pb-3">
        <div className="space-y-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HistoryIcon className="h-4 w-4" aria-hidden />
            {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("subtitle", { count: history.total })}</p>
        </div>
      </header>

      {history.items.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground"
          data-testid="product-stock-history-empty"
        >
          {t("empty")}
        </p>
      ) : (
        <ol className="space-y-2" data-testid="product-stock-history-list">
          {history.items.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              dateLocale={dateLocale}
              actionLabel={(a) =>
                ACTION_META[a] !== undefined ? t(`actions.${a as keyof typeof ACTION_META}`) : a
              }
            />
          ))}
        </ol>
      )}

      {history.total > history.pageSize ? (
        <p className="text-center text-[11px] text-muted-foreground">
          {t("showingLatest", {
            count: history.items.length,
            total: history.total,
          })}
        </p>
      ) : null}
    </section>
  );
}

function HistoryRow({
  entry,
  dateLocale,
  actionLabel,
}: {
  entry: AdminProductStockHistoryItem;
  dateLocale: typeof ru;
  actionLabel: (action: string) => string;
}): JSX.Element {
  const meta = ACTION_META[entry.action] ?? FALLBACK_META;
  const { Icon, toneCls } = meta;
  const variantParts = [entry.variantColor, entry.variantSize].filter(Boolean).join(" · ");
  const showQty = entry.delta !== 0;
  const showReserved = entry.reservedDelta !== 0;

  return (
    <li
      className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm"
      data-testid="product-stock-history-row"
      data-action={entry.action}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          toneCls,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium">{actionLabel(entry.action)}</span>
          {showQty ? (
            <span className="font-mono text-xs text-muted-foreground">
              {entry.oldQty} → <span className="font-semibold text-foreground">{entry.newQty}</span>
              <span
                className={cn(
                  "ml-1.5",
                  entry.delta > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400",
                )}
              >
                ({entry.delta > 0 ? "+" : ""}
                {entry.delta})
              </span>
            </span>
          ) : null}
          {showReserved ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              рез. {entry.oldReserved} → {entry.newReserved}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {entry.variantSku}
          </span>
          {variantParts ? <span>· {variantParts}</span> : null}
          <span>·</span>
          <span>{entry.branchNameRu}</span>
          {entry.adminEmail ? (
            <>
              <span>·</span>
              <span className="truncate">{entry.adminEmail}</span>
            </>
          ) : null}
        </div>
        {entry.reason ? (
          <p className="text-xs italic text-muted-foreground">«{entry.reason}»</p>
        ) : null}
      </div>
      <time
        className="shrink-0 text-[11px] text-muted-foreground"
        dateTime={entry.createdAt.toISOString()}
        title={entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
      >
        {formatDistanceToNowStrict(entry.createdAt, { addSuffix: true, locale: dateLocale })}
      </time>
    </li>
  );
}
