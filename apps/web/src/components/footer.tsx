import { Link } from "@bigmax/i18n/navigation";
import { BRAND, formatPhone } from "@bigmax/shared-types";
import { getTranslations } from "next-intl/server";

import { PaymentSystemLogos } from "@/components/payment-system-logos";

export async function Footer(): Promise<JSX.Element> {
  const t = await getTranslations();

  return (
    <footer className="border-t bg-muted/30">
      <div className="container grid gap-8 py-10 md:grid-cols-4">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bigmax-logo.svg"
            alt={BRAND.nameRu}
            className="h-12 w-auto"
            width={62}
            height={48}
          />
          <p className="mt-2 text-sm text-muted-foreground">{t("common.brandSlogan")}</p>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("footer.contacts")}
          </h3>
          <ul className="space-y-1 text-sm">
            <li>{t("footer.address")}</li>
            <li>
              <a className="hover:text-primary" href={`mailto:${BRAND.ordersEmail}`}>
                {BRAND.ordersEmail}
              </a>
            </li>
            <li>
              <a className="hover:text-primary" href={`tel:${BRAND.phone1}`}>
                {formatPhone(BRAND.phone1)}
              </a>
            </li>
            <li>
              <a className="hover:text-primary" href={`tel:${BRAND.phone2}`}>
                {formatPhone(BRAND.phone2)}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Telegram
          </h3>
          <ul className="space-y-1 text-sm">
            <li>
              <a
                className="hover:text-primary"
                href={`https://t.me/${BRAND.telegramChannel.slice(1)}`}
                target="_blank"
                rel="noreferrer"
              >
                {BRAND.telegramChannel}
              </a>
            </li>
            <li>
              <a
                className="hover:text-primary"
                href={`https://t.me/${BRAND.telegramBot.slice(1)}`}
                target="_blank"
                rel="noreferrer"
              >
                {BRAND.telegramBot}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("footer.legalTitle")}
          </h3>
          <ul className="space-y-1 text-sm">
            <li>
              <Link className="hover:text-primary" href={"/support" as never}>
                {t("footer.legalSupport")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-primary" href={"/offer" as never}>
                {t("footer.legalOffer")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-primary" href={"/payment" as never}>
                {t("footer.legalPayment")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-primary" href={"/agreement" as never}>
                {t("footer.legalAgreement")}
              </Link>
            </li>
            <li>
              <Link className="hover:text-primary" href={"/privacy" as never}>
                {t("footer.legalPrivacy")}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t py-4">
        <div className="container flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">{t("footer.rights")}</p>
          <Link href={"/payment" as never} aria-label={t("footer.legalPayment")}>
            <PaymentSystemLogos />
          </Link>
        </div>
      </div>
    </footer>
  );
}
