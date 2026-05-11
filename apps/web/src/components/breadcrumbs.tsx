/**
 * `<Breadcrumbs>` — generic public-facing хлебные крошки. Тот же визуальный
 * язык, что и `<AdminBreadcrumbs>`, но не зависит от admin-namespace и не
 * захардкожен на `/admin` root.
 *
 * Использование:
 *   <Breadcrumbs
 *     items={[
 *       { href: "/catalog", label: "Каталог" },
 *       { href: "/catalog/clothing", label: "Одежда" },
 *       { label: "Боди и комбинезоны" },
 *     ]}
 *   />
 *
 * Первый сегмент — иконка Home (link на `/`). Дальше items в порядке
 * иерархии. Последний item рендерится без link'а (current page).
 *
 * Pure render — ok для server components.
 */

import { Link } from "@bigmax/i18n/navigation";
import { ChevronRight, Home, type LucideIcon } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

export interface BreadcrumbEntry {
  /** Display text (locale-resolved caller-side). */
  label: string;
  /** Если задан — рендерится как ссылка. Без href — current page. */
  href?: string;
  /** Опц. иконка-префикс перед label (для секций "Каталог" / "Корзина" / etc.). */
  icon?: LucideIcon;
}

interface Props {
  items: BreadcrumbEntry[];
  /** ARIA-метка для иконки Home. По умолчанию "Главная". */
  homeLabel?: string;
  /** Куда ведёт Home. По умолчанию `/`. */
  homeHref?: string;
  className?: string;
}

export function Breadcrumbs({
  items,
  homeLabel = "Главная",
  homeHref = "/",
  className,
}: Props): JSX.Element {
  return (
    <nav
      aria-label="breadcrumb"
      className={cn("flex flex-wrap items-center gap-0.5 text-sm", className)}
    >
      <Link
        href={homeHref as never}
        aria-label={homeLabel}
        title={homeLabel}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground",
          "transition-colors duration-150 hover:bg-accent/50 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <Home className="h-3.5 w-3.5" aria-hidden />
      </Link>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isLink = !isLast && Boolean(item.href);
        const Icon = item.icon;

        const content = (
          <span className="inline-flex max-w-[220px] items-center gap-1.5">
            {Icon ? (
              <Icon
                className={cn("h-3.5 w-3.5 shrink-0", isLast ? "text-primary" : "opacity-70")}
                aria-hidden
              />
            ) : null}
            <span className="truncate" title={item.label}>
              {item.label}
            </span>
          </span>
        );

        return (
          <Fragment key={i}>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" aria-hidden />
            {isLink ? (
              <Link
                href={item.href as never}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground",
                  "transition-colors duration-150 hover:bg-accent/50 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                {content}
              </Link>
            ) : (
              <span
                className={cn(
                  "inline-flex h-7 items-center px-1.5",
                  isLast ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                aria-current={isLast ? "page" : undefined}
              >
                {content}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
