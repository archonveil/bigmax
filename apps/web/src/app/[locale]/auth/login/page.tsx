import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  params: { locale: string };
}

export default async function LoginPage({ params }: LoginPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const t = await getTranslations("auth.login");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-6">
        <LoginForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/auth/register" className="font-medium text-primary hover:underline">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
