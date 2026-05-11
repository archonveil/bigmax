import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalArticle, LegalSection } from "@/components/legal/legal-article";
import { absoluteUrl, languageAlternates } from "@/seo/config";

interface AgreementPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: AgreementPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.agreement" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/agreement", params.locale),
      languages: languageAlternates("/agreement"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/agreement", params.locale),
    },
  };
}

export default async function AgreementPage({ params }: AgreementPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("legal.agreement");
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
