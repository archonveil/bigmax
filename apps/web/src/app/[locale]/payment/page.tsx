import { BRAND, formatPhone, isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalArticle, LegalSection } from "@/components/legal/legal-article";
import { PaymentSystemLogos } from "@/components/payment-system-logos";
import { absoluteUrl, languageAlternates } from "@/seo/config";

interface PaymentPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PaymentPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.payment" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/payment", params.locale),
      languages: languageAlternates("/payment"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/payment", params.locale),
    },
  };
}

export default async function PaymentPage({ params }: PaymentPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("legal.payment");
  const tShared = await getTranslations("legal");

  return (
    <LegalArticle title={t("title")} updatedAt={tShared("updatedAt")}>
      <p>{t("intro")}</p>
      <LegalSection title={t("s1Title")}>
        <p>{t("s1Body")}</p>
        <PaymentSystemLogos className="pt-2" />
      </LegalSection>
      <LegalSection title={t("s2Title")}>
        <p>{t("s2Body1")}</p>
        <p>{t("s2Body2")}</p>
      </LegalSection>
      <LegalSection title={t("s3Title")}>
        <p>{t("s3Body")}</p>
      </LegalSection>
      <LegalSection title={t("s4Title")}>
        <p>{t("s4Body1")}</p>
        <p>{t("s4Body2")}</p>
      </LegalSection>
      <LegalSection title={t("s5Title")}>
        <p>{t("s5Body")}</p>
      </LegalSection>
      <LegalSection title={t("s6Title")}>
        <p>{t("s6Body")}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <a className="hover:text-primary" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>
          </li>
          <li>
            <a className="hover:text-primary" href={`tel:${BRAND.phone1}`}>
              {formatPhone(BRAND.phone1)}
            </a>
          </li>
        </ul>
      </LegalSection>
      <LegalSection title={t("s7Title")}>
        <p>{t("s7Body")}</p>
      </LegalSection>
    </LegalArticle>
  );
}
