/**
 * `/auth/password-reset` — request page (P6-T8 follow-up — closes (b)).
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PasswordResetRequestForm } from "@/components/auth/password-reset-request-form";

interface PageProps {
  params: { locale: string };
}

export default async function PasswordResetRequestPage({
  params,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  return <PasswordResetRequestForm />;
}
