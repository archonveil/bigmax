"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ContactsStepSchema, type ContactsStepInput } from "@/checkout/schemas";
import { nextStep, useCheckout } from "@/checkout/store";
import { AgreementCheckbox } from "@/components/legal/agreement-checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepContactsProps {
  initialPrefill: { name: string; email: string; phone: string };
  isAuthenticated: boolean;
}

const ContactsFormSchema = ContactsStepSchema.extend({
  agreement: z.boolean(),
});
type ContactsFormValues = z.infer<typeof ContactsFormSchema>;

export function StepContacts({ initialPrefill, isAuthenticated }: StepContactsProps): JSX.Element {
  const t = useTranslations("checkout.contacts");
  const tNav = useTranslations("checkout.nav");
  const tErr = useTranslations("checkout.errors");

  const stored = useCheckout((s) => s.contacts);
  const setContacts = useCheckout((s) => s.setContacts);
  const setStep = useCheckout((s) => s.setStep);

  const form = useForm<ContactsFormValues>({
    resolver: zodResolver(
      isAuthenticated
        ? ContactsFormSchema
        : ContactsFormSchema.refine((d) => d.agreement === true, {
            path: ["agreement"],
            message: "agreementRequired",
          }),
    ),
    defaultValues: {
      name: stored.name ?? initialPrefill.name,
      email: stored.email ?? initialPrefill.email,
      phone: stored.phone ?? initialPrefill.phone,
      agreement: false,
    },
  });

  function onSubmit(data: ContactsFormValues): void {
    const contacts: ContactsStepInput = {
      name: data.name,
      email: data.email,
      phone: data.phone,
    };
    setContacts(contacts);
    const next = nextStep("contacts");
    if (next) setStep(next);
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-xl font-semibold">{t("title")}</h2>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="checkout-name">{t("name")}</Label>
          <Input
            id="checkout-name"
            autoComplete="name"
            placeholder={t("namePlaceholder")}
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("required")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="checkout-email">{t("email")}</Label>
          <Input
            id="checkout-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            {...form.register("email")}
          />
          {form.formState.errors.email ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("invalidEmail")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="checkout-phone">{t("phone")}</Label>
          <Input
            id="checkout-phone"
            type="tel"
            autoComplete="tel"
            placeholder={t("phonePlaceholder")}
            {...form.register("phone")}
          />
          {form.formState.errors.phone ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("invalidPhone")}
            </p>
          ) : null}
        </div>

        {!isAuthenticated ? (
          <AgreementCheckbox
            label={(tags) => t.rich("agreementLabel", tags)}
            checked={form.watch("agreement") === true}
            onCheckedChange={(v) =>
              form.setValue("agreement", v, {
                shouldValidate: form.formState.isSubmitted,
              })
            }
            error={form.formState.errors.agreement ? tErr("agreementRequired") : undefined}
          />
        ) : null}

        <div className="flex justify-end pt-2">
          <Button type="submit">
            {tNav("next")}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </section>
  );
}
