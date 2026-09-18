import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalArticle, LegalSection } from "@/components/legal/legal-article";
import { absoluteUrl, languageAlternates } from "@/seo/config";

interface OfferPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: OfferPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.offer" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/offer", params.locale),
      languages: languageAlternates("/offer"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/offer", params.locale),
    },
  };
}

export default async function OfferPage({ params }: OfferPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("legal.offer");
  const tShared = await getTranslations("legal");

  return (
    <LegalArticle title={t("title")} updatedAt={tShared("updatedAt")}>
      <p className="whitespace-pre-line">{t("intro")}</p>
      <LegalSection title={t("s1Title")}>
        <p className="whitespace-pre-line">{t("s1Body")}</p>
      </LegalSection>
      <LegalSection title={t("s2Title")}>
        <p className="whitespace-pre-line">{t("s2Body")}</p>
      </LegalSection>
      <LegalSection title={t("s3Title")}>
        <p className="whitespace-pre-line">{t("s3Body")}</p>
      </LegalSection>
      <LegalSection title={t("s4Title")}>
        <p className="whitespace-pre-line">{t("s4Body")}</p>
      </LegalSection>
      <LegalSection title={t("s5Title")}>
        <p className="whitespace-pre-line">{t("s5Body")}</p>
      </LegalSection>
      <LegalSection title={t("s6Title")}>
        <p className="whitespace-pre-line">{t("s6Body")}</p>
      </LegalSection>
      <LegalSection title={t("s7Title")}>
        <p className="whitespace-pre-line">{t("s7Body")}</p>
      </LegalSection>
    </LegalArticle>
  );
}
