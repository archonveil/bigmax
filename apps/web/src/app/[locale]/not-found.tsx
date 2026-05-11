/**
 * Локаль-осознанная 404-страница. Рендерится когда внутри `/[locale]/...`
 * вызван `notFound()` или запрошен несуществующий маршрут. Next.js
 * автоматически использует этот файл из-за его расположения в сегменте
 * `[locale]`.
 */

import { Link } from "@bigmax/i18n/navigation";
import { Home, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function NotFoundPage(): Promise<JSX.Element> {
  const t = await getTranslations("errors.notFound");

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="mx-auto max-w-md text-center">
        <p className="text-6xl font-bold tracking-tight text-primary">404</p>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("body")}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/">
              <Home className="mr-2 h-4 w-4" aria-hidden />
              {t("backHome")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/catalog">
              <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />
              {t("openCatalog")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
