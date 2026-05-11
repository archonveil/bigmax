"use client";

import { Link, useRouter } from "@bigmax/i18n/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { EmailCredentialsSchema, OtpRequestSchema } from "@/auth/schemas";
import { TelegramLoginButton } from "@/components/auth/telegram-login-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFavorites } from "@/favorites/store";
import { syncFavoritesWithServer } from "@/favorites/sync";

type EmailForm = { email: string; password: string };
type PhoneForm = { phone: string };

export function LoginForm(): JSX.Element {
  const t = useTranslations("auth.login");
  const tErr = useTranslations("auth.errors");
  const locale = useLocale();
  const router = useRouter();

  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);

  const hasTelegramBot = Boolean(process.env["NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"]);

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(EmailCredentialsSchema),
    defaultValues: { email: "", password: "" },
  });
  const phoneForm = useForm<PhoneForm>({
    resolver: zodResolver(OtpRequestSchema.pick({ phone: true })),
    defaultValues: { phone: "" },
  });

  async function onEmailSubmit(values: EmailForm): Promise<void> {
    setEmailError(null);
    setEmailLoading(true);
    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });
    setEmailLoading(false);
    if (!result || result.error) {
      setEmailError(tErr("invalidCredentials"));
      return;
    }
    // Гость→юзер merge для favorites: `<FavoritesSync>` в root layout
    // mount-once и после login не ретригерится; явный вызов гарантирует
    // попадание локальных productIds в серверный Favorite-список.
    const guestIds = useFavorites.getState().items.map((it) => it.productId);
    await syncFavoritesWithServer(guestIds);
    router.push("/");
    router.refresh();
  }

  async function onPhoneSubmit(values: PhoneForm): Promise<void> {
    setPhoneError(null);
    setPhoneLoading(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: values.phone, locale }),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!body.ok) {
        if (body.reason === "rate_limited") setPhoneError(tErr("rateLimited"));
        else if (body.reason === "invalid_phone") setPhoneError(tErr("invalidPhone"));
        else setPhoneError(tErr("unknownError"));
        return;
      }
      router.push(`/auth/verify?phone=${encodeURIComponent(values.phone)}`);
    } catch {
      setPhoneError(tErr("networkError"));
    } finally {
      setPhoneLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Tabs defaultValue="email">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="email">{t("emailTab")}</TabsTrigger>
          <TabsTrigger value="phone">{t("phoneTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                {...emailForm.register("email")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={t("passwordPlaceholder")}
                {...emailForm.register("password")}
              />
            </div>
            {emailError ? (
              <p className="text-sm text-destructive" role="alert">
                {emailError}
              </p>
            ) : null}
            <div className="flex items-center justify-end">
              <Link
                href="/auth/password-reset"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                data-testid="login-forgot-password"
              >
                {t("forgotPassword")}
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={emailLoading}>
              {t("submitEmail")}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="phone">
          <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder={t("phonePlaceholder")}
                {...phoneForm.register("phone")}
              />
            </div>
            {phoneError ? (
              <p className="text-sm text-destructive" role="alert">
                {phoneError}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={phoneLoading}>
              {t("submitPhone")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {hasTelegramBot ? (
        <div className="space-y-3">
          <div
            className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground"
            role="separator"
          >
            <span aria-hidden className="h-px flex-1 bg-border" />
            <span>{t("orContinueWith")}</span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
          <TelegramLoginButton onError={setTelegramError} />
          {telegramError ? (
            <p className="text-center text-sm text-destructive" role="alert">
              {telegramError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
