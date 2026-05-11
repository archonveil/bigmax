import { routing } from "@bigmax/i18n/routing";
import { BRAND, isLocale, type Locale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";

import { AuthSessionProvider } from "@/components/auth/auth-session-provider";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { RouteProgressBar } from "@/components/route-progress-bar";
import { FavoritesSync } from "@/favorites/sync";
import { fontBody, fontHeading } from "@/lib/fonts";
import { absoluteUrl, languageAlternates, siteUrl } from "@/seo/config";
import { organizationLd, websiteLd } from "@/seo/json-ld";
import { JsonLd } from "@/seo/json-ld-script";

import "@/app/globals.css";

export function generateStaticParams(): Array<{ locale: Locale }> {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

// Pages под этим layout'ом hit'ят Prisma в RSC (catalog, account, etc.).
// `force-dynamic` отключает SSG-prerender при `next build` — без него
// build падает с PrismaClientInitializationError'ом потому что DB на
// этапе build'а недоступна. Pages всё равно cached через `unstable_cache`
// на read-side (taxonomy, categories — 10min TTL).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.home" });

  return {
    metadataBase: new URL(siteUrl()),
    title: {
      template: `%s — ${BRAND.nameRu}`,
      default: t("title"),
    },
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/", params.locale),
      languages: languageAlternates("/"),
    },
    openGraph: {
      type: "website",
      siteName: BRAND.nameRu,
      locale: params.locale,
      url: absoluteUrl("/", params.locale),
      title: t("title"),
      description: t("description"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
  };
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();

  // Нужно для static rendering — next-intl docs §static rendering.
  setRequestLocale(params.locale);

  const messages = await getMessages();

  return (
    <html lang={params.locale} className={`${fontBody.variable} ${fontHeading.variable}`}>
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        <AuthSessionProvider>
          <NextIntlClientProvider locale={params.locale} messages={messages}>
            <RouteProgressBar />
            <Header />
            {/* P7-T2 sub-task O: maintenance-banner, скрыт при пустом
                `brand.maintenance_message`. Между header и main, чтобы
                сообщение шло первым в reading-order, но под навигацией. */}
            <MaintenanceBanner />
            <main className="flex-1">{children}</main>
            <Footer />
            {/* Toast-слой: add-to-cart и прочие success/error нотификации. */}
            <Toaster position="bottom-right" richColors closeButton />
            {/* Mount-once: guest→user merge-sync избранного при логине. */}
            <FavoritesSync />
          </NextIntlClientProvider>
        </AuthSessionProvider>
        {/* Глобальный JSON-LD: Organization + WebSite. Страничные блоки
            (BreadcrumbList/ItemList/Product) инжектятся в своих page.tsx. */}
        <JsonLd data={[organizationLd(), websiteLd(params.locale as Locale)]} />
      </body>
    </html>
  );
}
