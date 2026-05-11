import { Link } from "@bigmax/i18n/navigation";
import { BRAND, formatPhone } from "@bigmax/shared-types";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CartButton } from "@/components/cart/cart-button";
import { CartSheet } from "@/components/cart/cart-sheet";
import { FavoritesHeaderButton } from "@/components/favorites/favorites-header-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SearchBox } from "@/components/search-box";

export async function Header(): Promise<JSX.Element> {
  const t = await getTranslations();
  const session = await auth();

  const label = session?.user
    ? (session.user.name ??
      (session.user.phone ? formatPhone(session.user.phone) : session.user.email) ??
      "")
    : null;
  const isPrivileged = session?.user.role === "admin" || session?.user.role === "manager";

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="container flex flex-col gap-3 py-3 md:h-16 md:flex-row md:items-center md:gap-6 md:py-0">
        <div className="flex items-center justify-between gap-4 md:justify-start">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-semibold tracking-tight"
            aria-label={BRAND.nameRu}
          >
            <span className="text-xl">{BRAND.nameRu}</span>
            <span className="hidden text-xs text-muted-foreground lg:inline">
              {t("common.brandSlogan")}
            </span>
          </Link>

          <nav className="flex items-center gap-3 text-sm md:hidden">
            {session ? (
              <>
                <Link
                  href="/account/profile"
                  className="max-w-[8rem] truncate font-medium hover:text-primary"
                >
                  {label}
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link href="/auth/login" className="hover:text-primary">
                {t("nav.login")}
              </Link>
            )}
            <FavoritesHeaderButton />
            <CartButton />
            <LanguageSwitcher />
          </nav>
        </div>

        <div className="min-w-0 flex-1 md:mx-4 md:max-w-xl">
          <SearchBox />
        </div>

        <nav className="hidden items-center gap-4 text-sm md:flex md:gap-6">
          <Link href="/" className="hover:text-primary">
            {t("nav.catalog")}
          </Link>

          {isPrivileged ? (
            <Link
              href="/admin"
              data-testid="header-admin-link"
              className="font-medium text-rose-700 hover:text-rose-900"
            >
              {t("admin.title")}
            </Link>
          ) : null}

          {session ? (
            <>
              <Link
                href="/account/profile"
                className="max-w-[10rem] truncate font-medium hover:text-primary"
              >
                {label}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/auth/login" className="hover:text-primary">
              {t("nav.login")}
            </Link>
          )}

          <FavoritesHeaderButton />
          <CartButton />
          <LanguageSwitcher />
        </nav>
      </div>

      <CartSheet />
    </header>
  );
}
