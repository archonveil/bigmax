"use client";

import { Link, usePathname } from "@bigmax/i18n/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface AccountNavItem {
  href:
    | "/account/profile"
    | "/account/password"
    | "/account/addresses"
    | "/account/orders"
    | "/account/loyalty";
  labelKey: "profile" | "password" | "addresses" | "orders" | "loyalty";
}

const ITEMS: AccountNavItem[] = [
  { href: "/account/profile", labelKey: "profile" },
  { href: "/account/password", labelKey: "password" },
  { href: "/account/addresses", labelKey: "addresses" },
  { href: "/account/orders", labelKey: "orders" },
  { href: "/account/loyalty", labelKey: "loyalty" },
];

export function AccountNav(): JSX.Element {
  const t = useTranslations("account.nav");
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:flex-col sm:gap-0.5">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
