"use client";

import {
  TASHKENT_CITY_SLUG,
  TASHKENT_DISTRICTS,
  toE164,
  UZ_REGIONS,
  type Locale,
} from "@bigmax/shared-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";

import { AddressCreateSchema, type AddressCreateInput } from "@/account/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AddressFormValues {
  region: string;
  city: string;
  district: string;
  street: string;
  house: string;
  apartment: string;
  landmark: string;
  phone: string;
  isDefault: boolean;
}

export const EMPTY_ADDRESS: AddressFormValues = {
  region: "",
  city: "",
  district: "",
  street: "",
  house: "",
  apartment: "",
  landmark: "",
  phone: "",
  isDefault: false,
};

interface AddressFormProps {
  initial?: AddressFormValues;
  mode: "create" | "edit";
  onSubmit: (values: AddressCreateInput) => Promise<void>;
  onCancel: () => void;
}

function localizedRegion(slug: string, locale: Locale): string {
  const r = UZ_REGIONS.find((x) => x.slug === slug);
  if (!r) return slug;
  return locale === "uz" ? r.nameUz : locale === "en" ? r.nameEn : r.nameRu;
}

function localizedDistrict(slug: string, locale: Locale): string {
  return locale === "uz"
    ? (TASHKENT_DISTRICTS.find((d) => d.slug === slug)?.nameUz ?? slug)
    : locale === "en"
      ? (TASHKENT_DISTRICTS.find((d) => d.slug === slug)?.nameEn ?? slug)
      : (TASHKENT_DISTRICTS.find((d) => d.slug === slug)?.nameRu ?? slug);
}

export function AddressForm({ initial, mode, onSubmit, onCancel }: AddressFormProps): JSX.Element {
  const t = useTranslations("account.addresses.form");
  const tErr = useTranslations("account.addresses.errors");
  const locale = useLocale() as Locale;

  // Явно указываем input (AddressFormValues — всё строки для controlled-inputs)
  // и output (AddressCreateInput — уже transformed Zod'ом: trim + ""→undefined).
  const form = useForm<AddressFormValues, unknown, AddressCreateInput>({
    resolver: zodResolver(AddressCreateSchema),
    defaultValues: initial ?? EMPTY_ADDRESS,
  });

  const selectedRegion = form.watch("region");
  const isTashkent = selectedRegion === TASHKENT_CITY_SLUG;

  async function handleSubmit(values: AddressCreateInput): Promise<void> {
    // Zod уже сделал trim и превратил пустые поля в undefined — просто форвардим.
    await onSubmit(values);
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="region">{t("region")}</Label>
          <Controller
            control={form.control}
            name="region"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="region">
                  <SelectValue placeholder={t("regionPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {UZ_REGIONS.map((r) => (
                    <SelectItem key={r.slug} value={r.slug}>
                      {localizedRegion(r.slug, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.region ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("invalidRegion")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">{t("city")}</Label>
          <Input id="city" placeholder={t("cityPlaceholder")} {...form.register("city")} />
          {form.formState.errors.city ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("invalidForm")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="district">{t("district")}</Label>
          <Input
            id="district"
            placeholder={t("districtPlaceholder")}
            list={isTashkent ? "tashkent-districts" : undefined}
            {...form.register("district")}
          />
          {isTashkent ? (
            <>
              <datalist id="tashkent-districts">
                {TASHKENT_DISTRICTS.map((d) => (
                  <option key={d.slug} value={localizedDistrict(d.slug, locale)} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">{t("districtHintTashkent")}</p>
            </>
          ) : null}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="street">{t("street")}</Label>
          <Input id="street" {...form.register("street")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="house">{t("house")}</Label>
          <Input id="house" {...form.register("house")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apartment">{t("apartment")}</Label>
          <Input id="apartment" {...form.register("apartment")} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="landmark">{t("landmark")}</Label>
          <Input
            id="landmark"
            placeholder={t("landmarkPlaceholder")}
            {...form.register("landmark")}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t("phonePlaceholder")}
            {...form.register("phone", {
              // Любой ввод / paste (+998 90 123-45-67, 998901234567, 901234567 и т.д.)
              // нормализуется в E.164 `+998XXXXXXXXX`, который и хранится в форме.
              onChange: (e) => {
                const e164 = toE164(e.target.value);
                if (e164 && e164 !== e.target.value) {
                  form.setValue("phone", e164, { shouldValidate: true });
                }
              },
              onBlur: (e) => {
                const v = e.target.value.trim();
                if (!v) return;
                const e164 = toE164(v);
                if (e164) form.setValue("phone", e164, { shouldValidate: true });
              },
            })}
          />
          {form.formState.errors.phone ? (
            <p className="text-xs text-destructive" role="alert">
              {tErr("invalidPhone")}
            </p>
          ) : null}
        </div>
      </div>

      <Controller
        control={form.control}
        name="isDefault"
        render={({ field }) => (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
            {t("isDefault")}
          </label>
        )}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {mode === "create" ? t("submitCreate") : t("submitEdit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
