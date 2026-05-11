"use client";

/**
 * `<PasswordResetCompleteForm>` (P6-T8 follow-up — closes (b)). Form для
 * ввода нового пароля. Token приходит из URL [token]. После успеха
 * показывается success-message + Link на /auth/login.
 */

import { Link } from "@bigmax/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  token: string;
}

export function PasswordResetCompleteForm({ token }: Props): JSX.Element {
  const t = useTranslations("auth.passwordReset.complete");
  const tErr = useTranslations("auth.passwordReset.complete.errors");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) {
      setError(tErr("passwordTooShort"));
      return;
    }
    if (password.length > 200) {
      setError(tErr("passwordTooLong"));
      return;
    }
    if (password !== confirm) {
      setError(tErr("passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && body.ok) {
        setSubmitted(true);
        return;
      }
      const key = body.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-4" data-testid="password-reset-complete-success">
        <h1 className="text-2xl font-semibold">{t("successTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("successBody")}</p>
        <Link
          href="/auth/login"
          className="inline-block text-sm text-primary hover:underline"
          data-testid="password-reset-go-to-login"
        >
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="password-reset-complete-form">
        <div className="space-y-2">
          <Label htmlFor="reset-password">{t("password")}</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={200}
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            data-testid="password-reset-password-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm">{t("passwordConfirm")}</Label>
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            data-testid="password-reset-confirm-input"
          />
        </div>
        {error ? (
          <p
            className="text-sm text-destructive"
            role="alert"
            data-testid="password-reset-complete-error"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={submitting}
          data-testid="password-reset-complete-submit"
        >
          {submitting ? t("submitting") : t("submit")}
        </Button>
      </form>
    </div>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"auth.passwordReset.complete.errors">>,
): string {
  const known = [
    "passwordMismatch",
    "passwordTooShort",
    "passwordTooLong",
    "tokenInvalid",
    "tokenExpired",
    "tokenAlreadyUsed",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
