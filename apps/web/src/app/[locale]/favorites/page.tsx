import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FavoritesPageClient } from "@/components/favorites/favorites-page";

interface FavoritesPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: FavoritesPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "favorites" });
  return {
    title: t("pageTitle"),
    // Избранное — private state (для гостя лежит в localStorage, для auth — в БД).
    robots: { index: false, follow: true },
  };
}

export default function FavoritesPage({ params }: FavoritesPageProps): JSX.Element {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  return <FavoritesPageClient />;
}
