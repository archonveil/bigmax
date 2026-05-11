/**
 * `/auth/password-reset/[token]` — complete page (P6-T8 follow-up — closes (b)).
 *
 * Token приходит из URL и передаётся в form. Validation + bcrypt-compare +
 * password update — на server-side через `/api/auth/password-reset/complete`.
 */

import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PasswordResetCompleteForm } from "@/components/auth/password-reset-complete-form";

interface PageProps {
  params: { locale: string; token: string };
}

export default async function PasswordResetCompletePage({
  params,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  return <PasswordResetCompleteForm token={params.token} />;
}
