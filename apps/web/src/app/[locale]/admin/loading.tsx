/**
 * Базовый skeleton для всех admin-страниц. Next.js обернёт layout сегмента
 * в `<Suspense>` и покажет этот fallback во время навигации в любую
 * `/admin/*` страницу. Per-route override'ы могут переопределять (например,
 * detail-страница в `[id]/loading.tsx`).
 */

import { FilterBarSkeleton, PageSkeleton, TableSkeleton } from "@/components/ui/loading-skeletons";

export default function AdminLoading(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy data-testid="admin-loading">
      <PageSkeleton />
      <FilterBarSkeleton />
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}
