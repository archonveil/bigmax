import { isLocale } from "@bigmax/shared-types";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { ProfileForm } from "@/components/account/profile-form";

interface ProfilePageProps {
  params: { locale: string };
}

// P1-18: рендерим из session — name/email/phone/language теперь в JWT.
// Без отдельного `prisma.user.findUnique` экономим ~10–20 мс на каждый просмотр.
export default async function ProfilePage({ params }: ProfilePageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const session = await auth();
  if (!session?.user.id) redirect(`/${params.locale}/auth/login`);

  const t = await getTranslations("account.profile");

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-6">
        <ProfileForm
          initial={{
            name: session.user.name ?? "",
            language: session.user.language,
            email: session.user.email ?? null,
            phone: session.user.phone,
          }}
        />
      </div>
    </>
  );
}
