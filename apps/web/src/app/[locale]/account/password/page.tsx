import { prisma } from "@bigmax/db";
import { isLocale } from "@bigmax/shared-types";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { PasswordForm } from "@/components/account/password-form";

interface PasswordPageProps {
  params: { locale: string };
}

export default async function PasswordPage({ params }: PasswordPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const session = await auth();
  if (!session?.user.id) redirect(`/${params.locale}/auth/login`);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user) redirect(`/${params.locale}/auth/login`);

  const hasPassword = user.passwordHash !== null;
  const t = await getTranslations("account.password");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasPassword ? t("subtitleChange") : t("subtitleSet")}
      </p>
      <div className="mt-6">
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </>
  );
}
