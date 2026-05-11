import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CartPageClient } from "@/components/cart/cart-page";

interface CartPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: CartPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "cart.page" });
  return {
    title: t("title"),
    // Корзина — private state пользователя, не индексируем.
    robots: { index: false, follow: true },
  };
}

export default function CartPage({ params }: CartPageProps): JSX.Element {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  return <CartPageClient />;
}
