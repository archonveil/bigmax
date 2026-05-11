import { Link } from "@bigmax/i18n/navigation";
import { isLocale, toE164 } from "@bigmax/shared-types";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { VerifyForm } from "@/components/auth/verify-form";

interface VerifyPageProps {
  params: { locale: string };
  searchParams: { phone?: string };
}

export default async function VerifyPage({
  params,
  searchParams,
}: VerifyPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const phone = searchParams.phone ? toE164(searchParams.phone) : null;
  if (phone === null) {
    redirect(`/${params.locale}/auth/login`);
  }

  const t = await getTranslations("auth.verify");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("subtitle", { phone })}</p>
      <div className="mt-6">
        <VerifyForm phone={phone} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/auth/login" className="font-medium text-primary hover:underline">
          {t("wrongNumber")}
        </Link>
      </p>
    </>
  );
}
