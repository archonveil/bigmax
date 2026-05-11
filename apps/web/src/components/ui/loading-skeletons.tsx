/**
 * Готовые `<Skeleton>`-композиции для loading.tsx файлов:
 *  - `<PageSkeleton>` — базовый header (breadcrumbs + title + subtitle).
 *  - `<TableSkeleton>` — admin-list (заголовок + N строк × M ячеек).
 *  - `<DetailSkeleton>` — admin/storefront detail (header + 2 секции).
 *  - `<CardGridSkeleton>` — каталожная сетка карточек.
 *
 * RSC-friendly (без `"use client"`) — могут использоваться напрямую в
 * `loading.tsx` файлах.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageSkeleton({
  withSubtitle = true,
  className,
}: {
  withSubtitle?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("space-y-3", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-64" />
      {withSubtitle ? <Skeleton className="h-4 w-96 max-w-full" /> : null}
    </div>
  );
}

export function FilterBarSkeleton({ items = 4 }: { items?: number }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-3">
      {Array.from({ length: items }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-44" />
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 6,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      <div
        className="grid gap-2 border-b bg-muted/30 px-3 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3/4" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-2 px-3 py-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn("h-4", c === 0 ? "w-5/6" : "w-2/3")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn("space-y-6", className)}>
      <PageSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({
  cards = 12,
  className,
}: {
  cards?: number;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-auto h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function ProductDetailSkeleton(): JSX.Element {
  return (
    <div className="space-y-8">
      <Skeleton className="h-4 w-64" />
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      </div>
    </div>
  );
}
