import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalArticle, LegalSection } from "@/components/legal/legal-article";
import { absoluteUrl, languageAlternates } from "@/seo/config";

interface PrivacyPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PrivacyPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.privacy" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/privacy", params.locale),
      languages: languageAlternates("/privacy"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/privacy", params.locale),
    },
  };
}

export default async function PrivacyPage({ params }: PrivacyPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("legal.privacy");
  const tShared = await getTranslations("legal");

  return (
    <LegalArticle title={t("title")} updatedAt={tShared("updatedAt")}>
      <p>{t("intro")}</p>
      <LegalSection title={t("s1Title")}>
        <p>{t("s1Body")}</p>
      </LegalSection>
      <LegalSection title={t("s2Title")}>
        <p>{t("s2Body")}</p>
      </LegalSection>
      <LegalSection title={t("s3Title")}>
        <p>{t("s3Body")}</p>
      </LegalSection>
      <LegalSection title={t("s4Title")}>
        <p>{t("s4Body")}</p>
      </LegalSection>
      <LegalSection title={t("s5Title")}>
        <p>{t("s5Body")}</p>
      </LegalSection>
    </LegalArticle>
  );
}
