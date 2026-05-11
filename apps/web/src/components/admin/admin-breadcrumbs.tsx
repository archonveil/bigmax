/**
 * `<AdminBreadcrumbs>` — advanced breadcrumbs для admin-страниц.
 *
 * Поведение:
 *  - Первый сегмент — `Home`-иконка (link на `/admin`), без текста (compact).
 *  - Каждый item с `labelKey` получает префикс-иконку, совпадающую с
 *    иконкой sidebar-навигации (Sparkles / ShoppingBag / Package / ...) —
 *    admin сразу узнаёт раздел.
 *  - Текст truncate'ится `max-w-[200px]` с `title=` fallback'ом, чтобы
 *    длинные имена (BGX-20260508-1234, длинные SKU, имена клиентов)
 *    не ломали layout.
 *  - Hover на ссылке: subtle `accent`-pill + текст переходит в `foreground`,
 *    с smooth `transition-colors` (выравнено с focus-style формочек).
 *  - Текущая страница (последний item): `font-medium text-foreground` без
 *    pill'а — это «вы тут», не кликабельно.
 *  - Separator — chevron в muted/40 (тоньше, не отвлекает).
 *
 * Pure render — без hooks/state, безопасно использовать в server components.
 */

import { Link } from "@bigmax/i18n/navigation";
import {
  Boxes,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Flag,
  Home,
  Layers,
  Megaphone,
  Package,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

type BreadcrumbLabelKey =
  | "dashboard"
  | "orders"
  | "payments"
  | "products"
  | "categories"
  | "brands"
  | "branches"
  | "stock"
  | "promo"
  | "customers"
  | "audit"
  | "features";

export interface BreadcrumbItem {
  /** Если задан `labelKey` — берём из `admin.nav.{key}` (P6-T1 namespace).
   *  Также используется для подстановки секционной иконки. */
  labelKey?: BreadcrumbLabelKey;
  /** Произвольный label (например, номер заказа). Имеет приоритет над `labelKey`. */
  label?: string;
  /** Если задан — рендерится как ссылка. Без href — plain text (current page). */
  href?: string;
}

/** Секционные иконки выровнены с `<AdminNav>` — admin узнаёт раздел
 *  по тому же визуальному маркеру в sidebar и breadcrumbs. */
const SECTION_ICONS: Record<BreadcrumbLabelKey, LucideIcon> = {
  dashboard: Sparkles,
  orders: ShoppingBag,
  payments: CircleDollarSign,
  products: Package,
  categories: Layers,
  brands: Tag,
  branches: Store,
  stock: Boxes,
  promo: Megaphone,
  customers: Users,
  audit: ClipboardList,
  features: Flag,
};

export function AdminBreadcrumbs({ items }: { items: BreadcrumbItem[] }): JSX.Element {
  const t = useTranslations("admin");
  const tNav = useTranslations("admin.nav");

  return (
    <nav
      aria-label="breadcrumb"
      className="flex flex-wrap items-center gap-0.5 text-sm"
      data-testid="admin-breadcrumbs"
    >
      <Link
        href="/admin"
        aria-label={t("breadcrumbs.home")}
        title={t("breadcrumbs.home")}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground",
          "transition-colors duration-150 hover:bg-accent/50 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <Home className="h-3.5 w-3.5" aria-hidden />
      </Link>

      {items.map((item, i) => {
        const text = item.label ?? (item.labelKey ? tNav(item.labelKey) : "");
        const SectionIcon = item.labelKey ? SECTION_ICONS[item.labelKey] : null;
        const isLast = i === items.length - 1;
        const isLink = !isLast && Boolean(item.href);

        const content = (
          <span className="inline-flex max-w-[220px] items-center gap-1.5">
            {SectionIcon ? (
              <SectionIcon
                className={cn("h-3.5 w-3.5 shrink-0", isLast ? "text-primary" : "opacity-70")}
                aria-hidden
              />
            ) : null}
            <span className="truncate" title={text}>
              {text}
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
