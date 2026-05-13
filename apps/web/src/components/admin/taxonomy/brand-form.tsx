"use client";

/**
 * `<BrandForm>` (P6-T4) — single-name (без локалей) форма для брендов.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slugify";
import type { AdminBrandDetail } from "@/server/admin-taxonomy";

type Mode = "create" | "edit";

interface FormState {
  name: string;
  slug: string;
  logoUrl: string;
  description: string;
  country: string;
}

function init(b?: AdminBrandDetail): FormState {
  return {
    name: b?.name ?? "",
    slug: b?.slug ?? "",
    logoUrl: b?.logoUrl ?? "",
    description: b?.description ?? "",
    country: b?.country ?? "",
  };
}

export function BrandForm({ mode, brand }: { mode: Mode; brand?: AdminBrandDetail }): JSX.Element {
  const t = useTranslations("admin.brands.form");
  const tErr = useTranslations("admin.taxonomyErrors");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => init(brand));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(() => Boolean(brand?.slug));

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const onNameChange = (v: string): void => {
    setState((s) => ({
      ...s,
      name: v,
      slug: slugTouched ? s.slug : slugify(v, { separator: "-", maxLength: 64 }),
    }));
  };

  const onSlugChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlugTouched(cleaned.length > 0);
    setState((s) => ({ ...s, slug: cleaned }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const body = {
      name: state.name,
      slug: state.slug,
      logoUrl: state.logoUrl === "" ? null : state.logoUrl,
      description: state.description === "" ? null : state.description,
      country: state.country === "" ? null : state.country,
    };
    try {
      const url = mode === "create" ? "/api/admin/brands" : `/api/admin/brands/${brand!.id}`;
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
          router.push(`/admin/brands/${data.id}`);
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
    if (!brand) return;
    if (!(await confirm({ description: t("deleteConfirm"), variant: "destructive" }))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/brands/${brand.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("delete"));
        router.push("/admin/brands");
        return;
      }
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="brand-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="bname">{t("fields.name")}</Label>
          <Input
            id="bname"
            data-testid="brand-form-name"
            required
            minLength={2}
            maxLength={120}
            value={state.name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="bslug">{t("fields.slug")}</Label>
          <Input
            id="bslug"
            data-testid="brand-form-slug"
            required
            minLength={2}
            maxLength={64}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
            value={state.slug}
            onChange={(e) => onSlugChange(e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{t("fields.slugHint")}</p>
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor="blogo" optional>
            {t("fields.logoUrl")}
          </FieldLabel>
          <Input
            id="blogo"
            data-testid="brand-form-logo-url"
            type="url"
            maxLength={2048}
            value={state.logoUrl}
            onChange={(e) => update("logoUrl", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <FieldLabel htmlFor="bcountry" optional>
            {t("fields.country")}
          </FieldLabel>
          <Input
            id="bcountry"
            data-testid="brand-form-country"
            maxLength={64}
            value={state.country}
            onChange={(e) => update("country", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor="bdesc" optional>
            {t("fields.description")}
          </FieldLabel>
          <textarea
            id="bdesc"
            data-testid="brand-form-description"
            maxLength={2000}
            value={state.description}
            onChange={(e) => update("description", e.target.value)}
            disabled={submitting}
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" data-testid="brand-form-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="brand-form-submit">
          {submitting ? t("submitting") : mode === "create" ? t("create") : t("submit")}
        </Button>
        {mode === "edit" ? (
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void onDelete()}
            data-testid="brand-form-delete"
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
    "name_too_short",
    "name_too_long",
    "slug_too_short",
    "slug_too_long",
    "slug_invalid",
    "slug_exists",
    "logo_url_invalid",
    "invalid_body",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`${key as (typeof known)[number]}`);
  }
  return t("generic");
}
