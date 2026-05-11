"use client";

import {
  localized,
  TASHKENT_CITY_SLUG,
  TASHKENT_DISTRICTS,
  type Locale,
  UZ_REGIONS,
} from "@bigmax/shared-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { AddressStepSchema, type AddressStepInput } from "@/checkout/schemas";
import { nextStep, prevStep, useCheckout } from "@/checkout/store";
import type { SavedAddress } from "@/components/checkout/checkout-page";
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

interface StepAddressProps {
  savedAddresses: SavedAddress[];
}

const NEW_ADDRESS_SENTINEL = "__new__";

export function StepAddress({ savedAddresses }: StepAddressProps): JSX.Element {
  const t = useTranslations("checkout.address");
  const tNav = useTranslations("checkout.nav");
  const tErr = useTranslations("checkout.errors");
  const locale = useLocale() as Locale;

  const stored = useCheckout((s) => s.address);
  const setAddress = useCheckout((s) => s.setAddress);
  const setStep = useCheckout((s) => s.setStep);

  // Если есть сохранённые адреса, по-умолчанию выбираем дефолтный,
  // иначе — режим «новый адрес».
  const defaultSaved = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;
  const [selectedSavedId, setSelectedSavedId] = useState<string>(
    defaultSaved ? defaultSaved.id : NEW_ADDRESS_SENTINEL,
  );
  const selectedSaved =
    selectedSavedId !== NEW_ADDRESS_SENTINEL
      ? (savedAddresses.find((a) => a.id === selectedSavedId) ?? null)
      : null;

  // Все optional поля инициализируются пустой строкой — совпадает с output-типом
  // Zod-схемы (`default("")`), поэтому обходимся без `as unknown as T`.
  const form = useForm<AddressStepInput>({
    resolver: zodResolver(AddressStepSchema),
    defaultValues: {
      region: stored.region ?? "",
      city: stored.city ?? "",
      district: stored.district ?? "",
      street: stored.street ?? "",
      house: stored.house ?? "",
      apartment: stored.apartment ?? "",
      landmark: stored.landmark ?? "",
      phone: stored.phone ?? "",
    },
  });

  // Когда юзер выбирает сохранённый адрес — заполняем форму его полями.
  useEffect(() => {
    if (!selectedSaved) return;
    form.reset({
      region: selectedSaved.region,
      city: selectedSaved.city,
      district: selectedSaved.district ?? "",
      street: selectedSaved.street ?? "",
      house: selectedSaved.house ?? "",
      apartment: selectedSaved.apartment ?? "",
      landmark: selectedSaved.landmark ?? "",
      phone: selectedSaved.phone ?? "",
    });
  }, [selectedSaved, form]);

  function onSubmit(data: AddressStepInput): void {
    setAddress(data);
    const next = nextStep("address");
    if (next) setStep(next);
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-xl font-semibold">{t("title")}</h2>

      {savedAddresses.length > 0 ? (
        <div className="mb-4 space-y-2">
          <Label htmlFor="saved-address">{t("useSaved")}</Label>
          <Select value={selectedSavedId} onValueChange={setSelectedSavedId}>
            <SelectTrigger id="saved-address">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {savedAddresses.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.city}, {a.street ?? ""} {a.house ?? ""}
                </SelectItem>
              ))}
              <SelectItem value={NEW_ADDRESS_SENTINEL}>{t("newAddress")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="addr-region">{t("region")}</Label>
            <Select
              value={form.watch("region")}
              onValueChange={(v) => form.setValue("region", v, { shouldValidate: true })}
            >
              <SelectTrigger id="addr-region">
                <SelectValue placeholder={t("regionPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {UZ_REGIONS.map((r) => (
                  <SelectItem key={r.slug} value={r.slug}>
                    {localized(r, "name", locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.region ? (
              <p className="text-xs text-destructive">{tErr("invalidRegion")}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="addr-city">{t("city")}</Label>
            <Input id="addr-city" placeholder={t("cityPlaceholder")} {...form.register("city")} />
            {form.formState.errors.city ? (
              <p className="text-xs text-destructive">{tErr("required")}</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="addr-district">{t("district")}</Label>
          {form.watch("region") === TASHKENT_CITY_SLUG ? (
            // Для Ташкента — селект с 11 районами (slug), чтобы `estimateDelivery`
            // мог надёжно разрулить tashkent-central vs tashkent-outer.
            <Select
              value={form.watch("district")}
              onValueChange={(v) => form.setValue("district", v, { shouldValidate: true })}
            >
              <SelectTrigger id="addr-district">
                <SelectValue placeholder={t("districtPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {TASHKENT_DISTRICTS.map((d) => (
                  <SelectItem key={d.slug} value={d.slug}>
                    {localized(d, "name", locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            // Для других регионов — свободный текст (контекст «микрорайон /
            // махалля»). Калькулятор для них игнорирует district.
            <Input
              id="addr-district"
              placeholder={t("districtPlaceholder")}
              {...form.register("district")}
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_140px_140px]">
          <div className="space-y-2">
            <Label htmlFor="addr-street">{t("street")}</Label>
            <Input id="addr-street" {...form.register("street")} />
            {form.formState.errors.street ? (
              <p className="text-xs text-destructive">{tErr("required")}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr-house">{t("house")}</Label>
            <Input id="addr-house" {...form.register("house")} />
            {form.formState.errors.house ? (
              <p className="text-xs text-destructive">{tErr("required")}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr-apartment">{t("apartment")}</Label>
            <Input id="addr-apartment" {...form.register("apartment")} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="addr-landmark">{t("landmark")}</Label>
          <Input
            id="addr-landmark"
            placeholder={t("landmarkPlaceholder")}
            {...form.register("landmark")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="addr-phone">{t("phone")}</Label>
          <Input
            id="addr-phone"
            type="tel"
            placeholder={t("phonePlaceholder")}
            {...form.register("phone")}
          />
          {form.formState.errors.phone ? (
            <p className="text-xs text-destructive">{tErr("invalidPhone")}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" onClick={() => setStep(prevStep("address")!)}>
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
