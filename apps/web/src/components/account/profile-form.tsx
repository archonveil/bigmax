"use client";

import { usePathname, useRouter } from "@bigmax/i18n/navigation";
import { formatPhone, LOCALES, LOCALE_LABELS, type Locale } from "@bigmax/shared-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ProfileUpdateSchema } from "@/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProfileFormProps {
  initial: {
    name: string;
    language: Locale;
    email: string | null;
    phone: string | null;
  };
}

type FormValues = {
  name: string;
  language: Locale;
  email: string;
};

export function ProfileForm({ initial }: ProfileFormProps): JSX.Element {
  const t = useTranslations("account.profile");
  const tErr = useTranslations("auth.errors");
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { update: updateSession } = useSession();

  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailLocked = initial.email !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(ProfileUpdateSchema),
    defaultValues: {
      name: initial.name,
      language: initial.language,
      email: initial.email ?? "",
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setStatus("idle");
    setErrorMessage(null);
    setSubmitting(true);

    const body: {
      name?: string;
      language?: Locale;
      email?: string;
    } = {
      name: values.name,
      language: values.language,
    };
    if (!emailLocked && values.email) body.email = values.email;

    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (!data.ok) {
        if (data.reason === "email_exists") setErrorMessage(tErr("emailExists"));
        else setErrorMessage(tErr("unknownError"));
        setStatus("error");
        return;
      }
      setStatus("success");
      // P1-18: пушим свежие name/email/language в JWT через NextAuth update(),
      // иначе следующий рендер `/account/profile` (который теперь читает из
      // session, а не из БД) увидит старые значения до next-token-refresh.
      await updateSession({
        name: values.name,
        ...(body.email !== undefined ? { email: body.email } : {}),
        language: values.language,
      });
      if (values.language !== currentLocale) {
        router.replace(pathname, { locale: values.language });
      } else {
        router.refresh();
      }
    } catch {
      setStatus("error");
      setErrorMessage(tErr("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          autoComplete="name"
          placeholder={t("namePlaceholder")}
          {...form.register("name")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="language">{t("language")}</Label>
        <Controller
          control={form.control}
          name="language"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground">{t("languageHint")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          readOnly={emailLocked}
          placeholder="you@example.com"
          {...form.register("email")}
        />
        {emailLocked ? <p className="text-xs text-muted-foreground">{t("emailLocked")}</p> : null}
      </div>

      {initial.phone ? (
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" value={formatPhone(initial.phone)} readOnly disabled />
          <p className="text-xs text-muted-foreground">{t("phoneLocked")}</p>
        </div>
      ) : null}

      {status === "success" ? (
        <p className="text-sm text-primary" role="status">
          {t("success")}
        </p>
      ) : null}
      {status === "error" && errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {t("submit")}
      </Button>
    </form>
  );
}
