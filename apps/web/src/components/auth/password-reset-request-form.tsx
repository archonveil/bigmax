"use client";

/**
 * `<PasswordResetRequestForm>` (P6-T8 follow-up — closes (b)). После
 * submit'а показывает success-message ВСЕГДА (даже для unknown email) —
 * tactical silence для anti-enumeration.
 */

import { Link } from "@bigmax/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordResetRequestForm(): JSX.Element {
  const t = useTranslations("auth.passwordReset.request");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.status === 429) {
        setError(t("rateLimited"));
        return;
      }
      // 200 ok ИЛИ 400 invalid_body — обрабатываем как success для tactical
      // silence (если invalid_email — Zod не пропустит). Если invalid_body
      // (malformed JSON) — это bug клиента, не показываем enumeration-leak.
      if (res.ok) {
        setSubmitted(true);
      } else {
        // Невалидный email — показываем generic ошибку.
        setError(t("rateLimited"));
      }
    } catch {
      setError(t("rateLimited"));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-4" data-testid="password-reset-request-success">
        <h1 className="text-2xl font-semibold">{t("successTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("successBody")}</p>
        <Link
          href="/auth/login"
          className="inline-block text-sm text-primary hover:underline"
          data-testid="password-reset-back-to-login"
        >
          {t("backToLogin")}
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
      <form onSubmit={onSubmit} className="space-y-4" data-testid="password-reset-request-form">
        <div className="space-y-2">
          <Label htmlFor="reset-email">{t("email")}</Label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            data-testid="password-reset-email-input"
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert" data-testid="password-reset-error">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={submitting}
          data-testid="password-reset-submit"
        >
          {submitting ? t("submitting") : t("submit")}
        </Button>
        <Link
          href="/auth/login"
          className="block text-center text-sm text-muted-foreground hover:underline"
        >
          {t("backToLogin")}
        </Link>
      </form>
    </div>
  );
}
