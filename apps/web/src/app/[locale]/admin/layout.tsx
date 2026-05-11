/**
 * Layout админ-панели (P6-T1, F13/§8 master-prompt).
 *
 * Защита в TWO слоях:
 *   1. **Middleware (edge)** уже отрабатывает `/admin/*` — на аноне 302 на
 *      `/auth/login`, на customer'е 302 на `/{locale}`. Это первая линия.
 *   2. **SSR layout (этот файл)** — defense-in-depth: если middleware был
 *      обойдён (баг, edge-cache stale, прямой rewrite в проде), сюда придёт
 *      запрос. `auth()` server-side читает session; не-privileged → notFound().
 *
 * Robots: noindex/nofollow — админка не должна индексироваться.
 */

import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminNav } from "@/components/admin/admin-nav";
import { RoleBadge, type AdminRole } from "@/components/admin/role-badge";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface AdminLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export default async function AdminLayout({
  children,
  params,
}: AdminLayoutProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const session = await auth();
  // Аноним — редиректим (middleware обычно ловит первым, но fallback нужен).
  if (!session?.user.id) {
    redirect(`/${params.locale}/auth/login`);
  }
  // Customer и неизвестные роли — 404 (не раскрываем существование админки).
  const role = session.user.role;
  if (role !== "admin" && role !== "manager") {
    notFound();
  }

  const t = await getTranslations("admin");

  return (
    <div className="container py-6 lg:py-10" data-testid="admin-shell">
      {/* Mobile-only header: hamburger + role-badge + user-name. */}
      <header className="mb-4 flex items-center gap-3 lg:hidden" data-testid="admin-mobile-header">
        <AdminMobileNav />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <RoleBadge role={role as AdminRole} />
          <span className="truncate">{session.user.name ?? session.user.email}</span>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        {/* Desktop-only aside (lg+). На мобиле AdminNav живёт в Sheet'е выше. */}
        <aside className="hidden space-y-4 lg:block">
          <header className="space-y-1.5">
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RoleBadge role={role as AdminRole} />
              <span className="truncate">{session.user.name ?? session.user.email}</span>
            </div>
          </header>
          <AdminNav />
        </aside>
        <section className="rounded-lg border bg-card p-6 sm:p-8">{children}</section>
      </div>
    </div>
  );
}
