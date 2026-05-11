"use client";

import { useRouter } from "@bigmax/i18n/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OtpRequestSchema, RegisterEmailSchema } from "@/auth/schemas";
import { AgreementCheckbox } from "@/components/legal/agreement-checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const agreementField = z.literal(true, { errorMap: () => ({ message: "agreementRequired" }) });
const RegisterEmailFormSchema = RegisterEmailSchema.extend({ agreement: agreementField });
const RegisterPhoneFormSchema = OtpRequestSchema.pick({ phone: true }).extend({
  agreement: agreementField,
});

type EmailForm = z.infer<typeof RegisterEmailFormSchema>;
type PhoneForm = z.infer<typeof RegisterPhoneFormSchema>;

export function RegisterForm(): JSX.Element {
  const t = useTranslations("auth.register");
  const tLogin = useTranslations("auth.login");
  const tErr = useTranslations("auth.errors");
  const locale = useLocale();
  const router = useRouter();

  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(RegisterEmailFormSchema),
    defaultValues: { name: "", email: "", password: "", agreement: false as unknown as true },
  });
  const phoneForm = useForm<PhoneForm>({
    resolver: zodResolver(RegisterPhoneFormSchema),
    defaultValues: { phone: "", agreement: false as unknown as true },
  });

  async function onEmailSubmit(values: EmailForm): Promise<void> {
    setEmailError(null);
    setEmailLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!body.ok) {
        if (body.reason === "email_exists") setEmailError(tErr("emailExists"));
        else setEmailError(tErr("invalidForm"));
        return;
      }
      const signInResult = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });
      if (!signInResult || signInResult.error) {
        setEmailError(tErr("unknownError"));
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setEmailError(tErr("networkError"));
    } finally {
      setEmailLoading(false);
    }
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
    <Tabs defaultValue="email">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="email">{tLogin("emailTab")}</TabsTrigger>
        <TabsTrigger value="phone">{tLogin("phoneTab")}</TabsTrigger>
      </TabsList>

      <TabsContent value="email">
        <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder={t("namePlaceholder")}
              {...emailForm.register("name")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{tLogin("email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={tLogin("emailPlaceholder")}
              {...emailForm.register("email")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{tLogin("password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder={tLogin("passwordPlaceholder")}
              {...emailForm.register("password")}
            />
          </div>
          <AgreementCheckbox
            label={(tags) => t.rich("agreementLabel", tags)}
            checked={emailForm.watch("agreement") === true}
            onCheckedChange={(v) =>
              emailForm.setValue("agreement", (v ? true : false) as unknown as true, {
                shouldValidate: emailForm.formState.isSubmitted,
              })
            }
            error={emailForm.formState.errors.agreement ? tErr("agreementRequired") : undefined}
          />
          {emailError ? (
            <p className="text-sm text-destructive" role="alert">
              {emailError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={emailLoading}>
            {t("submitEmail")}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="phone">
        <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone-reg">{tLogin("phone")}</Label>
            <Input
              id="phone-reg"
              type="tel"
              autoComplete="tel"
              placeholder={tLogin("phonePlaceholder")}
              {...phoneForm.register("phone")}
            />
          </div>
          <AgreementCheckbox
            label={(tags) => t.rich("agreementLabel", tags)}
            checked={phoneForm.watch("agreement") === true}
            onCheckedChange={(v) =>
              phoneForm.setValue("agreement", (v ? true : false) as unknown as true, {
                shouldValidate: phoneForm.formState.isSubmitted,
              })
            }
            error={phoneForm.formState.errors.agreement ? tErr("agreementRequired") : undefined}
          />
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
  );
}
