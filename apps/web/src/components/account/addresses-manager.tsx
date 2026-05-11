"use client";

import { useRouter } from "@bigmax/i18n/navigation";
import { findRegion, formatPhone, MAX_ADDRESSES_PER_USER, type Locale } from "@bigmax/shared-types";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { AddressCreateInput } from "@/account/schemas";
import { AddressForm, type AddressFormValues } from "@/components/account/address-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AddressItem {
  id: string;
  region: string;
  city: string;
  district: string | null;
  street: string | null;
  house: string | null;
  apartment: string | null;
  landmark: string | null;
  phone: string | null;
  isDefault: boolean;
}

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string };

interface AddressesManagerProps {
  initial: AddressItem[];
}

function formatAddressLine(a: AddressItem, locale: Locale): string {
  const region = findRegion(a.region);
  const regionName = region
    ? locale === "uz"
      ? region.nameUz
      : locale === "en"
        ? region.nameEn
        : region.nameRu
    : a.region;

  const parts: string[] = [regionName, a.city];
  if (a.district) parts.push(a.district);
  const streetBits: string[] = [];
  if (a.street) streetBits.push(a.street);
  if (a.house) streetBits.push(a.house);
  if (a.apartment) streetBits.push(a.apartment);
  if (streetBits.length > 0) parts.push(streetBits.join(", "));
  return parts.join(", ");
}

export function AddressesManager({ initial }: AddressesManagerProps): JSX.Element {
  const t = useTranslations("account.addresses");
  const tErr = useTranslations("auth.errors");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const reachedLimit = initial.length >= MAX_ADDRESSES_PER_USER;

  async function handleCreate(values: AddressCreateInput): Promise<void> {
    setError(null);
    const res = await fetch("/api/account/addresses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    if (!body.ok) {
      if (body.reason === "limit_reached") {
        setError(t("errors.limitReached", { limit: MAX_ADDRESSES_PER_USER }));
      } else {
        setError(tErr("unknownError"));
      }
      return;
    }
    setMode({ kind: "list" });
    router.refresh();
  }

  async function handleEdit(id: string, values: AddressCreateInput): Promise<void> {
    setError(null);
    const res = await fetch(`/api/account/addresses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    if (!body.ok) {
      setError(tErr("unknownError"));
      return;
    }
    setMode({ kind: "list" });
    router.refresh();
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    if (!window.confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
    const body = (await res.json()) as { ok: boolean };
    if (!body.ok) {
      setError(tErr("unknownError"));
      return;
    }
    router.refresh();
  }

  async function handleSetDefault(id: string): Promise<void> {
    setError(null);
    const res = await fetch(`/api/account/addresses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    const body = (await res.json()) as { ok: boolean };
    if (!body.ok) {
      setError(tErr("unknownError"));
      return;
    }
    router.refresh();
  }

  if (mode.kind === "create") {
    return (
      <AddressForm
        mode="create"
        onSubmit={handleCreate}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "edit") {
    const a = initial.find((x) => x.id === mode.id);
    if (!a) {
      setMode({ kind: "list" });
      return <></>;
    }
    const initValues: AddressFormValues = {
      region: a.region,
      city: a.city,
      district: a.district ?? "",
      street: a.street ?? "",
      house: a.house ?? "",
      apartment: a.apartment ?? "",
      landmark: a.landmark ?? "",
      phone: a.phone ? formatPhone(a.phone) : "",
      isDefault: a.isDefault,
    };
    return (
      <AddressForm
        mode="edit"
        initial={initValues}
        onSubmit={(v) => handleEdit(a.id, v)}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {initial.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {initial.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-lg border bg-card p-4",
                a.isDefault && "border-primary/40 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{formatAddressLine(a, locale)}</p>
                  {a.landmark ? (
                    <p className="mt-1 text-sm text-muted-foreground">{a.landmark}</p>
                  ) : null}
                  {a.phone ? (
                    <p className="mt-1 text-sm text-muted-foreground">{formatPhone(a.phone)}</p>
                  ) : null}
                  {a.isDefault ? (
                    <span className="mt-2 inline-flex rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      {t("defaultBadge")}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-0.5">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm font-normal text-muted-foreground hover:text-foreground"
                    onClick={() => setMode({ kind: "edit", id: a.id })}
                  >
                    {t("edit")}
                  </Button>
                  {!a.isDefault ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-sm font-normal text-muted-foreground hover:text-foreground"
                      onClick={() => void handleSetDefault(a.id)}
                    >
                      {t("setDefault")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm font-normal text-destructive"
                    onClick={() => void handleDelete(a.id)}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" onClick={() => setMode({ kind: "create" })} disabled={reachedLimit}>
        {t("addNew")}
      </Button>
      {reachedLimit ? (
        <p className="text-xs text-muted-foreground">
          {t("errors.limitReached", { limit: MAX_ADDRESSES_PER_USER })}
        </p>
      ) : null}
    </div>
  );
}
