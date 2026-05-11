"use client";

import { formatCurrencyUzs, type Locale } from "@bigmax/shared-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, MapPin, Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { DeliveryStepSchema, type DeliveryStepInput } from "@/checkout/schemas";
import { nextStep, prevStep, useCheckout } from "@/checkout/store";
import { useDeliveryEstimate } from "@/checkout/use-delivery-estimate";
import { BranchPicker } from "@/components/checkout/branch-picker";
import type { Branch } from "@/components/checkout/checkout-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface StepDeliveryProps {
  branches: Branch[];
}

export function StepDelivery({ branches }: StepDeliveryProps): JSX.Element {
  const t = useTranslations("checkout.delivery");
  const tCost = useTranslations("checkout.delivery.cost");
  const tNav = useTranslations("checkout.nav");
  const locale = useLocale() as Locale;

  const stored = useCheckout((s) => s.delivery);
  const setDelivery = useCheckout((s) => s.setDelivery);
  const setStep = useCheckout((s) => s.setStep);

  // Optional поля с `.default("")` в схеме — RHF defaultValues совпадает с
  // output-типом, обходимся без type-escape.
  const form = useForm<DeliveryStepInput>({
    resolver: zodResolver(DeliveryStepSchema),
    defaultValues: {
      method: stored.method ?? "courier",
      branchId: stored.branchId ?? "",
      comment: stored.comment ?? "",
    },
  });

  const method = form.watch("method");
  const estimate = useDeliveryEstimate();

  // Пишем в стор «на лету» при переключении радио — чтобы useDeliveryEstimate
  // увидел новое method и пересчитал сразу (без ожидания submit'а).
  const setDeliveryField = (m: "courier" | "pickup"): void => {
    form.setValue("method", m);
    setDelivery({
      method: m,
      branchId: form.getValues("branchId"),
      comment: form.getValues("comment"),
    });
  };

  function onSubmit(data: DeliveryStepInput): void {
    setDelivery({
      method: data.method,
      branchId: data.branchId,
      comment: data.comment,
    });
    const next = nextStep("delivery");
    if (next) setStep(next);
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-xl font-semibold">{t("title")}</h2>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <fieldset className="space-y-2">
          <MethodCard
            active={method === "courier"}
            onSelect={() => setDeliveryField("courier")}
            icon={<Truck className="h-5 w-5 text-primary" aria-hidden />}
            title={t("courier")}
            description={t("courierDescription")}
            inputProps={{
              ...form.register("method"),
              type: "radio",
              value: "courier",
              checked: method === "courier",
            }}
          />
          <MethodCard
            active={method === "pickup"}
            onSelect={() => setDeliveryField("pickup")}
            icon={<MapPin className="h-5 w-5 text-primary" aria-hidden />}
            title={t("pickup")}
            description={t("pickupDescription")}
            inputProps={{
              ...form.register("method"),
              type: "radio",
              value: "pickup",
              checked: method === "pickup",
            }}
          />
        </fieldset>

        <EstimatePreview estimate={estimate} method={method} locale={locale} tCost={tCost} />

        {method === "pickup" ? (
          <div className="space-y-2">
            <Label>{t("selectBranch")}</Label>
            <BranchPicker
              branches={branches}
              value={form.watch("branchId") ?? ""}
              onChange={(id) => form.setValue("branchId", id, { shouldValidate: true })}
              locale={locale}
            />
            {form.formState.errors.branchId ? (
              <p className="text-xs text-destructive">{t("branchRequired")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="delivery-comment">{t("comment")}</Label>
          <Input
            id="delivery-comment"
            placeholder={t("commentPlaceholder")}
            {...form.register("comment")}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" onClick={() => setStep(prevStep("delivery")!)}>
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

interface MethodCardProps {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}

interface EstimatePreviewProps {
  estimate: ReturnType<typeof useDeliveryEstimate>;
  method: "courier" | "pickup";
  locale: Locale;
  tCost: ReturnType<typeof useTranslations<"checkout.delivery.cost">>;
}

function EstimatePreview({ estimate, method, locale, tCost }: EstimatePreviewProps): JSX.Element {
  // Единая карточка-подсказка: слева — lable/значение, справа — ETA.
  let mainValue: string;
  let hint: string | null = null;
  let tone: "ok" | "muted" = "muted";

  if (estimate.kind === "priced") {
    if (estimate.cents === 0) {
      mainValue = tCost("free");
      tone = "ok";
      hint = method === "pickup" ? tCost("pickupReady") : etaText(estimate, tCost);
    } else {
      mainValue = formatCurrencyUzs(estimate.cents, locale);
      hint = etaText(estimate, tCost);
    }
  } else if (estimate.reason === "missing-region") {
    mainValue = tCost("needsRegion");
  } else if (estimate.reason === "missing-district") {
    mainValue = tCost("needsDistrict");
  } else {
    mainValue = tCost("needsRegion");
  }

  return (
    <div
      data-testid="delivery-estimate-preview"
      className="rounded-md border bg-muted/30 p-3 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{tCost("label")}</span>
        <span className={cn("font-medium", tone === "ok" && "text-primary")}>{mainValue}</span>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function etaText(
  est: Extract<ReturnType<typeof useDeliveryEstimate>, { kind: "priced" }>,
  tCost: ReturnType<typeof useTranslations<"checkout.delivery.cost">>,
): string {
  if (est.zone === "pickup") return tCost("pickupReady");
  const eta =
    est.minDays === est.maxDays
      ? tCost("etaSame", { days: est.minDays })
      : tCost("etaRange", { min: est.minDays, max: est.maxDays });
  return tCost("estimateNotice", { eta });
}

function MethodCard({
  active,
  onSelect,
  icon,
  title,
  description,
  inputProps,
}: MethodCardProps): JSX.Element {
  return (
    <label
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition",
        active ? "border-primary bg-primary/5" : "border-input hover:border-primary/40",
      )}
    >
      <input {...inputProps} className="sr-only" />
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
