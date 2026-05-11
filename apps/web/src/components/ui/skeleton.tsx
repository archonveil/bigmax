/**
 * `<Skeleton>` — shadcn-style placeholder с muted background и pulse-анимацией.
 * Используется в `loading.tsx` файлах и Suspense fallback'ах для замены контента,
 * пока RSC-сегмент стримится с сервера.
 */

import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted/70", className)} aria-hidden {...props} />
  );
}
