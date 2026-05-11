"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, CreditCard, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { PaymentStepSchema, type PaymentStepInput } from "@/checkout/schemas";
import { nextStep, prevStep, useCheckout } from "@/checkout/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StepPayment(): JSX.Element {
  const t = useTranslations("checkout.payment");
  const tNav = useTranslations("checkout.nav");

  const stored = useCheckout((s) => s.payment);
  const setPayment = useCheckout((s) => s.setPayment);
  const setStep = useCheckout((s) => s.setStep);

  const form = useForm<PaymentStepInput>({
    resolver: zodResolver(PaymentStepSchema),
    defaultValues: { method: stored.method ?? "uniteller" },
  });

  const method = form.watch("method");

  function onSubmit(data: PaymentStepInput): void {
    setPayment(data);
    const next = nextStep("payment");
    if (next) setStep(next);
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-xl font-semibold">{t("title")}</h2>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition",
            method === "uniteller"
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/40",
          )}
        >
          <input
            {...form.register("method")}
            type="radio"
            value="uniteller"
            checked={method === "uniteller"}
            onChange={() => form.setValue("method", "uniteller")}
            className="sr-only"
          />
          <CreditCard className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            <span className="block text-sm font-semibold">{t("card")}</span>
            <span className="block text-xs text-muted-foreground">{t("cardDescription")}</span>
          </span>
        </label>

        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition",
            method === "cod"
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/40",
          )}
        >
          <input
            {...form.register("method")}
            type="radio"
            value="cod"
            checked={method === "cod"}
            onChange={() => form.setValue("method", "cod")}
            className="sr-only"
          />
          <Wallet className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            <span className="block text-sm font-semibold">{t("cod")}</span>
            <span className="block text-xs text-muted-foreground">{t("codDescription")}</span>
          </span>
        </label>

        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" onClick={() => setStep(prevStep("payment")!)}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            {tNav("back")}
          </Button>
          <Button type="submit">
            {tNav("next")}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </section>
  );
}
