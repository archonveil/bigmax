import { BRAND, formatPhone, isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalArticle, LegalSection } from "@/components/legal/legal-article";
import { absoluteUrl, languageAlternates } from "@/seo/config";

interface SupportPageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: SupportPageProps): Promise<Metadata> {
  if (!isLocale(params.locale)) return {};
  const t = await getTranslations({ locale: params.locale, namespace: "seo.support" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: absoluteUrl("/support", params.locale),
      languages: languageAlternates("/support"),
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: absoluteUrl("/support", params.locale),
    },
  };
}

export default async function SupportPage({ params }: SupportPageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const t = await getTranslations("legal.support");

  return (
    <LegalArticle title={t("title")}>
      <p>{t("intro")}</p>

      <LegalSection title={t("contactsTitle")}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium text-foreground">{t("emailLabel")}</dt>
          <dd>
            <a className="hover:text-primary" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>
          </dd>

          <dt className="font-medium text-foreground">{t("phoneLabel")}</dt>
          <dd>{formatPhone(BRAND.phoneTemplate)}</dd>

          <dt className="font-medium text-foreground">{t("telegramLabel")}</dt>
          <dd>
            <a
              className="hover:text-primary"
              href={`https://t.me/${BRAND.telegramChannel.slice(1)}`}
              target="_blank"
              rel="noreferrer"
            >
              {BRAND.telegramChannel}
            </a>
          </dd>

          <dt className="font-medium text-foreground">{t("hoursLabel")}</dt>
          <dd>{t("hoursValue")}</dd>
        </dl>
      </LegalSection>

      <LegalSection title={t("faqTitle")}>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-foreground">{t("faqDeliveryQ")}</h3>
            <p className="mt-1">{t("faqDeliveryA")}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">{t("faqReturnQ")}</h3>
            <p className="mt-1">{t("faqReturnA")}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">{t("faqPaymentQ")}</h3>
            <p className="mt-1">{t("faqPaymentA")}</p>
          </div>
        </div>
      </LegalSection>
    </LegalArticle>
  );
}
