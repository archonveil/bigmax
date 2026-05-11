"use client";

import { useRouter } from "@bigmax/i18n/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { OtpCredentialsSchema } from "@/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VerifyFormProps {
  phone: string;
}

type CodeForm = { code: string };

const RESEND_SECONDS = 60;

export function VerifyForm({ phone }: VerifyFormProps): JSX.Element {
  const t = useTranslations("auth.verify");
  const tErr = useTranslations("auth.errors");
  const locale = useLocale();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  const form = useForm<CodeForm>({
    resolver: zodResolver(OtpCredentialsSchema.pick({ code: true })),
    defaultValues: { code: "" },
  });

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const id = setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCountdown]);

  async function onSubmit(values: CodeForm): Promise<void> {
    setError(null);
    setLoading(true);
    const result = await signIn("otp", {
      phone,
      code: values.code,
      redirect: false,
    });
    setLoading(false);
    if (!result || result.error) {
      setError(tErr("invalidOtp"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function onResend(): Promise<void> {
    if (resendCountdown > 0) return;
    setResending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, locale }),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!body.ok) {
        if (body.reason === "rate_limited") setError(tErr("rateLimited"));
        else setError(tErr("unknownError"));
        return;
      }
      setResendCountdown(RESEND_SECONDS);
    } catch {
      setError(tErr("networkError"));
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">{t("code")}</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder={t("codePlaceholder")}
          className="text-center text-lg tracking-[0.3em]"
          {...form.register("code")}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {t("submit")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={onResend}
        disabled={resendCountdown > 0 || resending}
      >
        {resendCountdown > 0 ? t("resendIn", { seconds: resendCountdown }) : t("resend")}
      </Button>
    </form>
  );
}
