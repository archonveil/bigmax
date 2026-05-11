import { prisma } from "@bigmax/db";
import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { CheckoutPageClient, type CheckoutInitial } from "@/components/checkout/checkout-page";
import { getActiveBranches } from "@/server/active-branches";
import { isLoyaltySpendEnabled } from "@/server/loyalty";

interface CheckoutPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: CheckoutPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "checkout" });
  return {
    title: t("pageTitle"),
    // Чекаут — private state, не индексируем.
    robots: { index: false, follow: false },
  };
}

export default async function CheckoutPage({ params }: CheckoutPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const session = await auth();

  // P7-T2 sub-task M: глобальный kill-switch `loyalty.spend_enabled`
  // читается SSR-side. Если false — UI скроет `<LoyaltyBlock>` целиком,
  // юзер не увидит input и не словит surprise (server-guard в checkout/pay
  // всё равно был бы, но это не UX-friendly).
  const loyaltySpendEnabled = await isLoyaltySpendEnabled();

  const initial: CheckoutInitial = {
    isAuthenticated: Boolean(session?.user.id),
    contacts: {
      name: session?.user.name ?? "",
      email: session?.user.email ?? "",
      phone: session?.user.phone ?? "",
    },
    savedAddresses: [],
    branches: [],
    // P7-T2: баланс баллов «Бигмах Бонус» — 0 для гостей, реальный для авт.
    loyaltyBalance: 0,
    loyaltySpendEnabled,
  };

  if (session?.user.id) {
    const [addresses, branches, user] = await Promise.all([
      prisma.address.findMany({
        where: { userId: session.user.id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          region: true,
          city: true,
          district: true,
          street: true,
          house: true,
          apartment: true,
          landmark: true,
          phone: true,
          isDefault: true,
        },
      }),
      getActiveBranches(),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { loyaltyPoints: true },
      }),
    ]);
    initial.savedAddresses = addresses;
    initial.branches = branches;
    initial.loyaltyBalance = user?.loyaltyPoints ?? 0;
  } else {
    // Филиалы публичны (нужны и гостю для самовывоза).
    initial.branches = await getActiveBranches();
  }

  return <CheckoutPageClient initial={initial} />;
}
