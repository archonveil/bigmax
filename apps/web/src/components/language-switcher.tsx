"use client";

import { Link, usePathname } from "@bigmax/i18n/navigation";
import { LOCALE_LABELS, LOCALES } from "@bigmax/shared-types";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  className?: string;
}

/**
 * Сохраняет текущий путь при переключении языка:
 * /uz/catalog/clothing → /en/catalog/clothing.
 *
 * `usePathname()` из @bigmax/i18n/navigation возвращает путь без
 * локали-префикса; `<Link locale={...}>` затем добавит нужную.
 */
export function LanguageSwitcher({ className }: LanguageSwitcherProps): JSX.Element {
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label="language" className={cn("flex items-center gap-1 text-sm", className)}>
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === current ? "page" : undefined}
          className={cn(
            "rounded px-2 py-1 uppercase transition-colors",
            locale === current
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {locale}
          <span className="sr-only"> — {LOCALE_LABELS[locale]}</span>
        </Link>
      ))}
    </nav>
  );
}
