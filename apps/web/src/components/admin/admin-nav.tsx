"use client";

/**
 * Боковая навигация админ-панели (P6-T1). Подсвечивает текущий раздел
 * через `usePathname()` (locale-independent — снимаем locale-prefix вручную).
 *
 * Большинство ссылок — заглушки до P6-T2..T8 (по mounted layout-у они
 * будут 404 пока соответствующие route'ы не созданы). Это намеренно:
 * P6-T1 фиксирует scope меню, чтобы каждый последующий task просто
 * добавлял свою страницу под уже-зарегистрированную ссылку.
 */

import { Link } from "@bigmax/i18n/navigation";
import {
  Boxes,
  CircleDollarSign,
  ClipboardList,
  Flag,
  ImageMinus,
  Layers,
  Megaphone,
  Package,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";

interface NavItem {
  href: string;
  labelKey:
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
    | "features"
    | "imagesCleanup";
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Когда соответствующий route ещё не реализован — серый dot. */
  wip?: boolean;
}

/**
 * Заказы и платежи приходят первыми в P6-T5/T6 — они не WIP. Остальные
 * остаются WIP до своих P6-T*. По мере реализации флаг снимается.
 */
const NAV: ReadonlyArray<NavItem> = [
  { href: "/admin", labelKey: "dashboard", icon: Sparkles },
  { href: "/admin/orders", labelKey: "orders", icon: ShoppingBag },
  { href: "/admin/payments", labelKey: "payments", icon: CircleDollarSign },
  { href: "/admin/products", labelKey: "products", icon: Package },
  { href: "/admin/categories", labelKey: "categories", icon: Layers },
  { href: "/admin/brands", labelKey: "brands", icon: Tag },
  { href: "/admin/branches", labelKey: "branches", icon: Store },
  { href: "/admin/stock", labelKey: "stock", icon: Boxes },
  { href: "/admin/promo", labelKey: "promo", icon: Megaphone },
  { href: "/admin/customers", labelKey: "customers", icon: Users },
  { href: "/admin/audit", labelKey: "audit", icon: ClipboardList },
  // P7-T2 sub-task G: runtime feature flags (loyalty.earn_percent etc.).
  { href: "/admin/features", labelKey: "features", icon: Flag },
  // Phase 7: orphan-images cleanup (FS files not referenced from DB).
  { href: "/admin/images-cleanup", labelKey: "imagesCleanup", icon: ImageMinus },
];

export function AdminNav(): JSX.Element {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  // Снимаем локальный префикс — `/ru/admin/orders` → `/admin/orders`.
  const stripped = stripLocale(pathname);

  return (
    <nav aria-label="admin" className="space-y-1" data-testid="admin-nav">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/admin"
            ? stripped === "/admin"
            : stripped === item.href || stripped.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-testid={`admin-nav-${item.labelKey}`}
            data-active={active ? "true" : "false"}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{t(item.labelKey)}</span>
            {item.wip ? (
              <span
                aria-hidden
                title="Скоро"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
              />
            ) : null}
          </Link>
        );
      })}
      <div className="border-t pt-3 mt-3">
        <Link
          href="/"
          data-testid="admin-nav-back-to-shop"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          {t("backToShop")}
        </Link>
      </div>
    </nav>
  );
}

function stripLocale(pathname: string): string {
  const m = /^\/(ru|uz|en)(\/.*)?$/.exec(pathname);
  return m ? (m[2] ?? "/") : pathname;
}
