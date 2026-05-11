"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { PasswordChangeSchema } from "@/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordFormProps {
  hasPassword: boolean;
}

type FormValues = {
  currentPassword?: string;
  newPassword: string;
};

export function PasswordForm({ hasPassword }: PasswordFormProps): JSX.Element {
  const t = useTranslations("account.password");
  const tErr = useTranslations("auth.errors");

  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(PasswordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setStatus("idle");
    setErrorMessage(null);
    setSubmitting(true);

    const body: { currentPassword?: string; newPassword: string } = {
      newPassword: values.newPassword,
    };
    if (hasPassword && values.currentPassword) {
      body.currentPassword = values.currentPassword;
    }

    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; reason?: string };
      if (!data.ok) {
        setStatus("error");
        if (data.reason === "wrong_current") setErrorMessage(t("errorWrongCurrent"));
        else if (data.reason === "current_required") setErrorMessage(t("errorWrongCurrent"));
        else setErrorMessage(tErr("unknownError"));
        return;
      }
      setStatus("success");
      form.reset({ currentPassword: "", newPassword: "" });
    } catch {
      setStatus("error");
      setErrorMessage(tErr("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {hasPassword ? (
        <div className="space-y-2">
          <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...form.register("currentPassword")}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="newPassword">{t("newPassword")}</Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          placeholder={t("newPasswordPlaceholder")}
          {...form.register("newPassword")}
        />
      </div>

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
        {hasPassword ? t("submitChange") : t("submitSet")}
      </Button>
    </form>
  );
}
