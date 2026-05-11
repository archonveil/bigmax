import { Link } from "@bigmax/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("home");

  return (
    <section className="container py-16 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{t("heroTitle")}</h1>
        <p className="mt-6 text-lg text-muted-foreground">{t("heroSubtitle")}</p>
        <div className="mt-8 flex justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/catalog">{t("heroCta")}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
