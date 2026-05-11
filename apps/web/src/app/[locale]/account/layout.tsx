import { isLocale } from "@bigmax/shared-types";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { AccountNav } from "@/components/account/account-nav";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface AccountLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export default async function AccountLayout({
  children,
  params,
}: AccountLayoutProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();

  const session = await auth();
  if (!session?.user.id) {
    redirect(`/${params.locale}/auth/login`);
  }

  return (
    <div className="container grid gap-8 py-10 sm:grid-cols-[12rem_1fr]">
      <aside>
        <AccountNav />
      </aside>
      <section className="rounded-lg border bg-card p-6 sm:p-8">{children}</section>
    </div>
  );
}
