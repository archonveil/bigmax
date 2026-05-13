"use client";

/**
 * `<BranchForm>` (P6-T4) — multilingual name+address (3 локали) + контакты
 * + geo (lat/lng).
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyFromRuButton, LocaleFallbackHint } from "@/components/ui/locale-fallback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdminBranchDetail } from "@/server/admin-taxonomy";

// Leaflet/Yandex хардкорят `window` → SSR-небезопасно. Lazy-loading + skeleton до hydration.
// Если задан `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` — рендерим Yandex (свежая
// CIS-data, родная UX). Иначе — Leaflet с Esri/Carto/OSM-tiles как fallback.
const HAS_YANDEX_KEY = Boolean(process.env["NEXT_PUBLIC_YANDEX_MAPS_API_KEY"]);

const PickerSkeleton = (): JSX.Element => (
  <div aria-hidden className="h-[372px] w-full animate-pulse rounded-md border bg-muted/30" />
);

const YandexLocationPicker = dynamic(
  () => import("@/components/admin/taxonomy/yandex-location-picker"),
  { ssr: false, loading: PickerSkeleton },
);

const LeafletLocationPicker = dynamic(
  () => import("@/components/admin/taxonomy/branch-location-picker"),
  { ssr: false, loading: PickerSkeleton },
);

const BranchLocationPicker = HAS_YANDEX_KEY ? YandexLocationPicker : LeafletLocationPicker;

type Mode = "create" | "edit";

interface FormState {
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  addressRu: string;
  addressUz: string;
  addressEn: string;
  phone: string;
  workingHours: string;
  latitude: string;
  longitude: string;
  isActive: boolean;
}

function init(b?: AdminBranchDetail): FormState {
  return {
    slug: b?.slug ?? "",
    nameRu: b?.nameRu ?? "",
    nameUz: b?.nameUz ?? "",
    nameEn: b?.nameEn ?? "",
    addressRu: b?.addressRu ?? "",
    addressUz: b?.addressUz ?? "",
    addressEn: b?.addressEn ?? "",
    phone: b?.phone ?? "",
    workingHours: b?.workingHours ?? "",
    latitude: b?.latitude !== null && b?.latitude !== undefined ? String(b.latitude) : "",
    longitude: b?.longitude !== null && b?.longitude !== undefined ? String(b.longitude) : "",
    isActive: b?.isActive ?? true,
  };
}

export function BranchForm({
  mode,
  branch,
}: {
  mode: Mode;
  branch?: AdminBranchDetail;
}): JSX.Element {
  const t = useTranslations("admin.branches.form");
  const tErr = useTranslations("admin.taxonomyErrors");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => init(branch));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const body = {
      slug: state.slug.trim() === "" ? null : state.slug.trim(),
      nameRu: state.nameRu,
      nameUz: state.nameUz,
      nameEn: state.nameEn,
      addressRu: state.addressRu,
      addressUz: state.addressUz,
      addressEn: state.addressEn,
      phone: state.phone === "" ? null : state.phone,
      workingHours: state.workingHours === "" ? null : state.workingHours,
      latitude: state.latitude === "" ? null : Number.parseFloat(state.latitude),
      longitude: state.longitude === "" ? null : Number.parseFloat(state.longitude),
      isActive: state.isActive,
    };
    try {
      const url = mode === "create" ? "/api/admin/branches" : `/api/admin/branches/${branch!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as { id: string };
        if (mode === "create") {
          toast.success(t("submit"));
          router.push(`/admin/branches/${data.id}`);
        } else {
          toast.success(t("submit"));
          router.refresh();
        }
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      const key = errBody.message ?? errBody.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = useConfirm();
  const onDelete = async (): Promise<void> => {
    if (!branch) return;
    if (!(await confirm({ description: t("deleteConfirm"), variant: "destructive" }))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/branches/${branch.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("delete"));
        router.push("/admin/branches");
        return;
      }
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="branch-form">
      <Tabs defaultValue="ru" className="space-y-3">
        <TabsList>
          <TabsTrigger value="ru">RU</TabsTrigger>
          <TabsTrigger value="uz">UZ</TabsTrigger>
          <TabsTrigger value="en">EN</TabsTrigger>
        </TabsList>
        {(["ru", "uz", "en"] as const).map((loc) => {
          const nameKey = `name${loc.charAt(0).toUpperCase()}${loc.charAt(1)}` as
            | "nameRu"
            | "nameUz"
            | "nameEn";
          const addrKey = `address${loc.charAt(0).toUpperCase()}${loc.charAt(1)}` as
            | "addressRu"
            | "addressUz"
            | "addressEn";
          const isRu = loc === "ru";
          return (
            <TabsContent key={loc} value={loc} className="space-y-3">
              {!isRu ? (
                <>
                  <div className="flex justify-end">
                    <CopyFromRuButton
                      onCopy={() =>
                        setState((s) => ({
                          ...s,
                          [nameKey]: s.nameRu,
                          [addrKey]: s.addressRu,
                        }))
                      }
                      disabled={submitting}
                      testId={`branch-form-copy-from-ru-${loc}`}
                    />
                  </div>
                  <LocaleFallbackHint />
                </>
              ) : null}
              <div>
                {isRu ? (
                  <FieldLabel htmlFor={`brn-name-${loc}`} required>
                    {t(`fields.${nameKey}`)}
                  </FieldLabel>
                ) : (
                  <FieldLabel htmlFor={`brn-name-${loc}`} optional>
                    {t(`fields.${nameKey}`)}
                  </FieldLabel>
                )}
                <Input
                  id={`brn-name-${loc}`}
                  data-testid={`branch-form-name-${loc}`}
                  {...(isRu ? { required: true, minLength: 2 } : {})}
                  maxLength={200}
                  value={state[nameKey]}
                  onChange={(e) => update(nameKey, e.target.value)}
                  disabled={submitting}
                  {...(!isRu ? { placeholder: state.nameRu } : {})}
                />
              </div>
              <div>
                {isRu ? (
                  <FieldLabel htmlFor={`brn-addr-${loc}`} required>
                    {t(`fields.${addrKey}`)}
                  </FieldLabel>
                ) : (
                  <FieldLabel htmlFor={`brn-addr-${loc}`} optional>
                    {t(`fields.${addrKey}`)}
                  </FieldLabel>
                )}
                <textarea
                  id={`brn-addr-${loc}`}
                  data-testid={`branch-form-address-${loc}`}
                  {...(isRu ? { required: true, minLength: 3 } : {})}
                  maxLength={500}
                  value={state[addrKey]}
                  onChange={(e) => update(addrKey, e.target.value)}
                  disabled={submitting}
                  {...(!isRu ? { placeholder: state.addressRu } : {})}
                  className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
                />
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="brnslug">{t("fields.slug")}</Label>
          <Input
            id="brnslug"
            data-testid="branch-form-slug"
            minLength={2}
            maxLength={64}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
            value={state.slug}
            onChange={(e) => update("slug", e.target.value.toLowerCase())}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{t("fields.slugHint")}</p>
        </div>
        <div>
          <FieldLabel htmlFor="brnphone" optional>
            {t("fields.phone")}
          </FieldLabel>
          <Input
            id="brnphone"
            data-testid="branch-form-phone"
            type="tel"
            maxLength={32}
            value={state.phone}
            onChange={(e) => update("phone", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <FieldLabel htmlFor="brnhours" optional>
            {t("fields.workingHours")}
          </FieldLabel>
          <Input
            id="brnhours"
            data-testid="branch-form-hours"
            maxLength={200}
            value={state.workingHours}
            onChange={(e) => update("workingHours", e.target.value)}
            disabled={submitting}
          />
        </div>
      </section>

      {/* Map-based geo picker: click / drag / search / locate-me. Раскрытие
          через details — admin может пропустить, если не настраивает геолокацию. */}
      <details
        open={state.latitude !== "" || state.longitude !== ""}
        className="group rounded-md border bg-card p-4 [&[open]_svg.chevron]:rotate-180"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            {t("fields.locationSection")}
            {state.latitude !== "" && state.longitude !== "" ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {t("fields.locationSet")}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {t("fields.locationNotSet")}
              </span>
            )}
          </span>
          <svg
            className="chevron h-4 w-4 text-muted-foreground transition-transform"
            viewBox="0 0 20 20"
            aria-hidden
            fill="currentColor"
          >
            <path
              d="M5.5 7.5L10 12l4.5-4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="mt-3 space-y-3">
          <BranchLocationPicker
            latitude={state.latitude === "" ? null : Number.parseFloat(state.latitude)}
            longitude={state.longitude === "" ? null : Number.parseFloat(state.longitude)}
            onChange={(lat, lng) => {
              setState((s) => ({
                ...s,
                latitude: lat === null ? "" : String(lat),
                longitude: lng === null ? "" : String(lng),
              }));
            }}
            disabled={submitting}
          />
          {/* Manual lat/lng inputs (для power-user'ов: вставить готовые координаты). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="brnlat" optional>
                {t("fields.latitude")}
              </FieldLabel>
              <Input
                id="brnlat"
                data-testid="branch-form-lat"
                type="number"
                step="any"
                min={-90}
                max={90}
                value={state.latitude}
                onChange={(e) => update("latitude", e.target.value)}
                disabled={submitting}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <FieldLabel htmlFor="brnlng" optional>
                {t("fields.longitude")}
              </FieldLabel>
              <Input
                id="brnlng"
                data-testid="branch-form-lng"
                type="number"
                step="any"
                min={-180}
                max={180}
                value={state.longitude}
                onChange={(e) => update("longitude", e.target.value)}
                disabled={submitting}
                className="font-mono text-sm"
              />
            </div>
          </div>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="branch-form-active"
          checked={state.isActive}
          onChange={(e) => update("isActive", e.target.checked)}
          disabled={submitting}
        />
        <span>{t("fields.isActive")}</span>
      </label>

      {error ? (
        <p className="text-sm text-destructive" data-testid="branch-form-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="branch-form-submit">
          {submitting ? t("submitting") : mode === "create" ? t("create") : t("submit")}
        </Button>
        {mode === "edit" ? (
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void onDelete()}
            data-testid="branch-form-delete"
          >
            {t("delete")}
          </Button>
        ) : null}
      </footer>
    </form>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.taxonomyErrors">>,
): string {
  const known = [
    "name_ru_too_short",
    "name_uz_too_short",
    "name_en_too_short",
    "name_too_long",
    "address_ru_too_short",
    "address_uz_too_short",
    "address_en_too_short",
    "address_too_long",
    "invalid_body",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`${key as (typeof known)[number]}`);
  }
  return t("generic");
}
