import { prisma } from "@bigmax/db";
import { isLocale } from "@bigmax/shared-types";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { AddressesManager, type AddressItem } from "@/components/account/addresses-manager";

interface AddressesPageProps {
  params: { locale: string };
}

export default async function AddressesPage({ params }: AddressesPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const session = await auth();
  if (!session?.user.id) redirect(`/${params.locale}/auth/login`);

  const addresses: AddressItem[] = await prisma.address.findMany({
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
  });

  const t = await getTranslations("account.addresses");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <div className="mt-6">
        <AddressesManager initial={addresses} />
      </div>
    </>
  );
}
