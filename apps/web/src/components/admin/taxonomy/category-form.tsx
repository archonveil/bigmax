"use client";

/**
 * `<CategoryForm>` (P6-T4) — общая форма для create + edit с табами ru/uz/en
 * для name. Slug, parent, icon, order — общие поля.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CategoryParentPicker } from "@/components/admin/taxonomy/category-parent-picker";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyFromRuButton, LocaleFallbackHint } from "@/components/ui/locale-fallback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { slugify } from "@/lib/slugify";
import type { AdminCategoryDetail, CategoryParentChoice } from "@/server/admin-taxonomy";

type Mode = "create" | "edit";

interface FormState {
  nameRu: string;
  nameUz: string;
  nameEn: string;
  slug: string;
  parentId: string; // "" = top-level
  iconUrl: string;
  order: string;
  isActive: boolean;
}

function init(p?: AdminCategoryDetail): FormState {
  return {
    nameRu: p?.nameRu ?? "",
    nameUz: p?.nameUz ?? "",
    nameEn: p?.nameEn ?? "",
    slug: p?.slug ?? "",
    parentId: p?.parentId ?? "",
    iconUrl: p?.iconUrl ?? "",
    order: String(p?.order ?? 0),
    isActive: p?.isActive ?? true,
  };
}

export function CategoryForm({
  mode,
  category,
  parentChoices,
}: {
  mode: Mode;
  category?: AdminCategoryDetail;
  parentChoices: CategoryParentChoice[];
}): JSX.Element {
  const t = useTranslations("admin.categories.form");
  const tErr = useTranslations("admin.taxonomyErrors");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => init(category));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-slug: пока user не правил slug руками, подставляем из nameRu.
  const [slugTouched, setSlugTouched] = useState(() => Boolean(category?.slug));

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const onNameRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      nameRu: v,
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
      nameRu: state.nameRu,
      nameUz: state.nameUz,
      nameEn: state.nameEn,
      slug: state.slug,
      parentId: state.parentId === "" ? null : state.parentId,
      iconUrl: state.iconUrl === "" ? null : state.iconUrl,
      order: state.order === "" ? 0 : Number.parseInt(state.order, 10),
      isActive: state.isActive,
    };
    try {
      const url =
        mode === "create" ? "/api/admin/categories" : `/api/admin/categories/${category!.id}`;
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
          router.push(`/admin/categories/${data.id}`);
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

  const onDelete = async (): Promise<void> => {
    if (!category) return;
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/categories/${category.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("delete"));
        router.push("/admin/categories");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        reason?: string;
        productsCount?: number;
      };
      if (body.reason === "category_in_use") {
        setError(tErr("category_in_use", { count: body.productsCount ?? 0 }));
      } else {
        setError(tErr("generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="category-form">
      <Tabs defaultValue="ru" className="space-y-3">
        <TabsList>
          <TabsTrigger value="ru">RU</TabsTrigger>
          <TabsTrigger value="uz">UZ</TabsTrigger>
          <TabsTrigger value="en">EN</TabsTrigger>
        </TabsList>
        <TabsContent value="ru" className="space-y-1.5">
          <FieldLabel htmlFor="cnameRu" required>
            {t("fields.nameRu")}
          </FieldLabel>
          <Input
            id="cnameRu"
            data-testid="category-form-name-ru"
            required
            minLength={2}
            maxLength={200}
            value={state.nameRu}
            onChange={(e) => onNameRuChange(e.target.value)}
            disabled={submitting}
          />
        </TabsContent>
        <TabsContent value="uz" className="space-y-2">
          <div className="flex justify-end">
            <CopyFromRuButton
              onCopy={() => setState((s) => ({ ...s, nameUz: s.nameRu }))}
              disabled={submitting}
              testId="category-form-copy-from-ru-uz"
            />
          </div>
          <LocaleFallbackHint />
          <FieldLabel htmlFor="cnameUz" optional>
            {t("fields.nameUz")}
          </FieldLabel>
          <Input
            id="cnameUz"
            data-testid="category-form-name-uz"
            maxLength={200}
            value={state.nameUz}
            onChange={(e) => update("nameUz", e.target.value)}
            disabled={submitting}
            placeholder={state.nameRu}
          />
        </TabsContent>
        <TabsContent value="en" className="space-y-2">
          <div className="flex justify-end">
            <CopyFromRuButton
              onCopy={() => setState((s) => ({ ...s, nameEn: s.nameRu }))}
              disabled={submitting}
              testId="category-form-copy-from-ru-en"
            />
          </div>
          <LocaleFallbackHint />
          <FieldLabel htmlFor="cnameEn" optional>
            {t("fields.nameEn")}
          </FieldLabel>
          <Input
            id="cnameEn"
            data-testid="category-form-name-en"
            maxLength={200}
            value={state.nameEn}
            onChange={(e) => update("nameEn", e.target.value)}
            disabled={submitting}
            placeholder={state.nameRu}
          />
        </TabsContent>
      </Tabs>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="cslug">{t("fields.slug")}</Label>
          <Input
            id="cslug"
            data-testid="category-form-slug"
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
        <div className="space-y-1.5">
          <FieldLabel htmlFor="cparent" optional>
            {t("fields.parent")}
          </FieldLabel>
          <CategoryParentPicker
            id="cparent"
            value={state.parentId === "" ? null : state.parentId}
            onChange={(v) => update("parentId", v ?? "")}
            choices={parentChoices}
            disabled={submitting}
          />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor="cicon" optional>
            {t("fields.iconUrl")}
          </FieldLabel>
          <Input
            id="cicon"
            data-testid="category-form-icon-url"
            type="url"
            maxLength={2048}
            value={state.iconUrl}
            onChange={(e) => update("iconUrl", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="corder">{t("fields.order")}</Label>
          <Input
            id="corder"
            data-testid="category-form-order"
            type="number"
            min={0}
            max={9999}
            value={state.order}
            onChange={(e) => update("order", e.target.value)}
            disabled={submitting}
          />
        </div>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="category-form-active"
          checked={state.isActive}
          onChange={(e) => update("isActive", e.target.checked)}
          disabled={submitting}
        />
        <span>{t("fields.isActive")}</span>
      </label>

      {error ? (
        <p className="text-sm text-destructive" data-testid="category-form-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="category-form-submit">
          {submitting ? t("submitting") : mode === "create" ? t("create") : t("submit")}
        </Button>
        {mode === "edit" ? (
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void onDelete()}
            data-testid="category-form-delete"
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
    "slug_too_short",
    "slug_too_long",
    "slug_invalid",
    "slug_exists",
    "icon_url_invalid",
    "invalid_relation",
    "invalid_body",
    "parent_cycle",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`${key as (typeof known)[number]}`);
  }
  return t("generic");
}
