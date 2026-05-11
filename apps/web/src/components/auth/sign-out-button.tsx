"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface SignOutButtonProps {
  className?: string;
}

export function SignOutButton({ className }: SignOutButtonProps): JSX.Element {
  const t = useTranslations("account.nav");
  return (
    <button
      type="button"
      onClick={() => {
        void signOut({ callbackUrl: "/" });
      }}
      className={cn("text-muted-foreground transition-colors hover:text-foreground", className)}
    >
      {t("signOut")}
    </button>
  );
}
