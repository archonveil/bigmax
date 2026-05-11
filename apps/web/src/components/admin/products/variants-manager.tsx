"use client";

/**
 * `<VariantsManager>` (P6-T3 follow-up) — inline-table вариантов товара
 * + Dialog с формой для create/edit. Delete — через `window.confirm` +
 * DELETE API.
 *
 * UX:
 *   - Список variants — table со всеми полями + Edit/Delete кнопки.
 *   - Add new — `<Button>` сверху → Dialog с пустой формой.
 *   - Edit — клик по строке (Edit-кнопке) → тот же Dialog с pre-filled.
 *   - Save → POST/PATCH → toast + router.refresh.
 *   - Delete → confirm → DELETE → router.refresh; на 409 (variant_in_use)
 *     показывает inline-toast с count'ом заказов.
 */

import type { Locale } from "@bigmax/shared-types";
import { formatCurrencyUzs } from "@bigmax/shared-types";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  pickOptionLabel,
  resolveColorOption,
  type AttributeOption,
} from "@/catalog/category-attributes";
import {
  ProductImageManager,
  type ProductImageInput,
} from "@/components/admin/products/product-image-manager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminVariant } from "@/server/admin-products";

type Mode = { kind: "create" } | { kind: "edit"; variant: AdminVariant };

interface FormState {
  sku: string;
  color: string;
  size: string;
  priceCents: string; // string для удобства number-input'а
  oldPriceCents: string;
  barcode: string;
  weightGrams: string;
  images: ProductImageInput[];
}

const EMPTY_FORM: FormState = {
  sku: "",
  color: "",
  size: "",
  priceCents: "",
  oldPriceCents: "",
  barcode: "",
  weightGrams: "",
  images: [],
};

function variantToForm(v: AdminVariant): FormState {
  return {
    sku: v.sku,
    color: v.color ?? "",
    size: v.size ?? "",
    priceCents: String(v.priceCents),
    oldPriceCents: v.oldPriceCents !== null ? String(v.oldPriceCents) : "",
    barcode: v.barcode ?? "",
    weightGrams: v.weightGrams !== null ? String(v.weightGrams) : "",
    images: v.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      sizes: img.sizes,
      avifSizes: img.avifSizes,
    })),
  };
}

export function VariantsManager({
  productId,
  productSlug,
  variants,
  locale,
  colorOptions = [],
}: {
  productId: string;
  /** Slug продукта — используется как префикс auto-generated SKU. */
  productSlug: string;
  variants: AdminVariant[];
  locale: Locale;
  /** Options for the color picker — derived from category color attribute. */
  colorOptions?: readonly AttributeOption[];
}): JSX.Element {
  const t = useTranslations("admin.products.variants");
  const [openMode, setOpenMode] = useState<Mode | null>(null);

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="variants-manager">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <Button
          size="sm"
          onClick={() => setOpenMode({ kind: "create" })}
          data-testid="variant-add-button"
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {t("addNew")}
        </Button>
      </header>

      {variants.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="variants-empty"
        >
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="variants-table">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">{t("table.sku")}</th>
                <th className="px-2 py-1.5 text-left">{t("table.color")}</th>
                <th className="px-2 py-1.5 text-left">{t("table.size")}</th>
                <th className="px-2 py-1.5 text-right">{t("table.price")}</th>
                <th className="px-2 py-1.5 text-right">{t("table.oldPrice")}</th>
                <th className="px-2 py-1.5 text-left">{t("table.barcode")}</th>
                <th className="px-2 py-1.5 text-right">{t("table.weight")}</th>
                <th className="px-2 py-1.5 text-right">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {variants.map((v) => {
                const colorOption = resolveColorOption(v.color, colorOptions);
                const colorLabel = colorOption
                  ? pickOptionLabel(colorOption, locale)
                  : (v.color ?? t("noColor"));
                return (
                  <tr key={v.id} data-testid="variant-row" data-variant-id={v.id}>
                    <td className="px-2 py-2 font-mono">{v.sku}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {v.color !== null && v.color !== "" ? (
                        <span className="inline-flex items-center gap-1.5">
                          {colorOption?.color ? (
                            <span
                              aria-hidden
                              className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                              style={{ backgroundColor: colorOption.color }}
                            />
                          ) : null}
                          {colorLabel}
                        </span>
                      ) : (
                        t("noColor")
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{v.size ?? t("noSize")}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      {formatCurrencyUzs(v.priceCents, locale)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-muted-foreground line-through">
                      {v.oldPriceCents !== null ? formatCurrencyUzs(v.oldPriceCents, locale) : "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {v.barcode ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {v.weightGrams ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenMode({ kind: "edit", variant: v })}
                          data-testid="variant-edit-button"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <DeleteButton productId={productId} variantId={v.id} sku={v.sku} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openMode !== null ? (
        <VariantDialog
          productId={productId}
          productSlug={productSlug}
          mode={openMode}
          onClose={() => setOpenMode(null)}
          colorOptions={colorOptions}
          locale={locale}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dialog (create + edit)
// ---------------------------------------------------------------------------

function VariantDialog({
  productId,
  productSlug,
  mode,
  onClose,
  colorOptions,
  locale,
}: {
  colorOptions: readonly AttributeOption[];
  locale: Locale;
  productId: string;
  productSlug: string;
  mode: Mode;
  onClose: () => void;
}): JSX.Element {
  const t = useTranslations("admin.products.variants");
  const tForm = useTranslations("admin.products.variants.form");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() =>
    mode.kind === "edit"
      ? variantToForm(mode.variant)
      : { ...EMPTY_FORM, sku: buildSku(productSlug, "", "") },
  );
  // Auto-SKU: пока user не правил SKU вручную, изменения color/size
  // подставляют SKU через `buildSku`. Create-режим открывается с уже
  // pre-filled slug-based SKU (юзер видит и может сабмитить как есть).
  // Edit-режим стартует с touched=true — никогда не перетираем сохранённый SKU.
  const [skuTouched, setSkuTouched] = useState(() => mode.kind === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const updateColor = (v: string): void => {
    setState((s) => ({
      ...s,
      color: v,
      sku: skuTouched ? s.sku : buildSku(productSlug, v, s.size),
    }));
  };

  const updateSize = (v: string): void => {
    setState((s) => ({
      ...s,
      size: v,
      sku: skuTouched ? s.sku : buildSku(productSlug, s.color, v),
    }));
  };

  const onSkuChange = (raw: string): void => {
    setSkuTouched(raw !== "");
    setState((s) => ({ ...s, sku: raw.toUpperCase() }));
  };

  const regenerateSku = (): void => {
    setSkuTouched(false);
    setState((s) => ({ ...s, sku: buildSku(productSlug, s.color, s.size) }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {};
    body["sku"] = state.sku.trim();
    body["color"] = state.color.trim() === "" ? null : state.color.trim();
    body["size"] = state.size.trim() === "" ? null : state.size.trim();
    body["priceCents"] = state.priceCents === "" ? 0 : Number.parseInt(state.priceCents, 10);
    body["oldPriceCents"] =
      state.oldPriceCents === "" ? null : Number.parseInt(state.oldPriceCents, 10);
    body["barcode"] = state.barcode.trim() === "" ? null : state.barcode.trim();
    body["weightGrams"] = state.weightGrams === "" ? null : Number.parseInt(state.weightGrams, 10);
    body["images"] = state.images.map((img, i) => ({
      ...(img.id !== undefined ? { id: img.id } : {}),
      url: img.url,
      alt: img.alt ?? null,
      order: i,
      ...(img.sizes ? { sizes: img.sizes } : {}),
      ...(img.avifSizes ? { avifSizes: img.avifSizes } : {}),
    }));

    try {
      const url =
        mode.kind === "create"
          ? `/api/admin/products/${productId}/variants`
          : `/api/admin/products/${productId}/variants/${mode.variant.id}`;
      const method = mode.kind === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(mode.kind === "create" ? tForm("successCreate") : tForm("successUpdate"));
        router.refresh();
        onClose();
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      const key = errBody.message ?? errBody.reason ?? "generic";
      setError(translateError(key, tForm));
    } catch {
      setError(tForm("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent
        data-testid="variant-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode.kind === "create" ? tForm("createTitle") : tForm("editTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="my-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="vsku">{t("table.sku")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={regenerateSku}
                  disabled={submitting}
                  data-testid="variant-form-sku-generate"
                  className="h-7 text-xs"
                >
                  {tForm("skuGenerate")}
                </Button>
              </div>
              <Input
                id="vsku"
                data-testid="variant-form-sku"
                required
                minLength={2}
                maxLength={64}
                pattern="^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?$"
                value={state.sku}
                onChange={(e) => onSkuChange(e.target.value)}
                disabled={submitting}
                placeholder={buildSku(productSlug, state.color, state.size) || "SKU"}
              />
              <p className="text-xs text-muted-foreground">{tForm("skuHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vcolor">{t("table.color")}</Label>
              {colorOptions.length > 0 ? (
                <Select
                  value={state.color === "" ? "__none__" : state.color}
                  onValueChange={(v) => updateColor(v === "__none__" ? "" : v)}
                  disabled={submitting}
                >
                  <SelectTrigger id="vcolor" data-testid="variant-form-color">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">—</span>
                    </SelectItem>
                    {colorOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="flex items-center gap-2">
                          {o.color ? (
                            <span
                              aria-hidden
                              className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-border"
                              style={{ backgroundColor: o.color }}
                            />
                          ) : null}
                          {pickOptionLabel(o, locale)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="vcolor"
                  data-testid="variant-form-color"
                  maxLength={64}
                  value={state.color}
                  onChange={(e) => updateColor(e.target.value)}
                  disabled={submitting}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vsize">{t("table.size")}</Label>
              <Input
                id="vsize"
                data-testid="variant-form-size"
                maxLength={32}
                value={state.size}
                onChange={(e) => updateSize(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vprice">{t("table.price")}</Label>
              <Input
                id="vprice"
                data-testid="variant-form-price"
                type="number"
                required
                min={0}
                max={1_000_000_000}
                value={state.priceCents}
                onChange={(e) => update("priceCents", e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voldprice">{t("table.oldPrice")}</Label>
              <Input
                id="voldprice"
                data-testid="variant-form-old-price"
                type="number"
                min={0}
                max={1_000_000_000}
                value={state.oldPriceCents}
                onChange={(e) => update("oldPriceCents", e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vbarcode">{t("table.barcode")}</Label>
              <Input
                id="vbarcode"
                data-testid="variant-form-barcode"
                maxLength={64}
                value={state.barcode}
                onChange={(e) => update("barcode", e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vweight">{t("table.weight")}</Label>
              <Input
                id="vweight"
                data-testid="variant-form-weight"
                type="number"
                min={0}
                max={100_000}
                value={state.weightGrams}
                onChange={(e) => update("weightGrams", e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Картинки группируются по `colorTag = variant.color` — все sibling-
              варианты того же цвета РАЗДЕЛЯЮТ один и тот же набор. Edit'ы
              отражаются на всех siblings'ах автоматически. Если у варианта
              нет color'а, fallback на per-variant linkage. */}
          <div className="my-4 space-y-2">
            {state.color.trim() !== "" ? (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                {tForm("sharedImagesHint", { color: state.color })}
              </p>
            ) : (
              <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {tForm("perVariantImagesHint")}
              </p>
            )}
            <ProductImageManager
              value={state.images}
              onChange={(next) => update("images", next)}
              disabled={submitting}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid="variant-form-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {tForm("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="variant-form-submit">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {tForm("saving")}
                </>
              ) : mode.kind === "create" ? (
                tForm("create")
              ) : (
                tForm("save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete (with confirm + 409 handling)
// ---------------------------------------------------------------------------

function DeleteButton({
  productId,
  variantId,
  sku,
}: {
  productId: string;
  variantId: string;
  sku: string;
}): JSX.Element {
  const tForm = useTranslations("admin.products.variants.form");
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = async (): Promise<void> => {
    if (submitting) return;
    if (typeof window !== "undefined" && !window.confirm(tForm("deleteConfirm"))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}/variants/${variantId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(tForm("successDelete"));
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        reason?: string;
        ordersCount?: number;
      };
      if (body.reason === "variant_in_use") {
        toast.error(tForm("errors.variant_in_use", { count: body.ordersCount ?? 0 }));
        return;
      }
      toast.error(tForm("errors.generic"));
    } finally {
      setSubmitting(false);
    }
    void sku;
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void onClick()}
      disabled={submitting}
      data-testid="variant-delete-button"
      aria-label={`Delete ${sku}`}
    >
      <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Auto-generates SKU from `productSlug` + `color` + `size`. Rules:
 *  - Compose dash-joined parts (skipping empty ones).
 *  - Uppercase, transliterate to ASCII through char filter.
 *  - Drop characters outside `[A-Z0-9_-]`, collapse repeated dashes.
 *  - Trim leading/trailing dashes/underscores; clip to 64 chars.
 *  - Falls back to "" when result would be empty (caller renders placeholder).
 */
export function buildSku(productSlug: string, color: string, size: string): string {
  const parts = [productSlug, color, size].map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return "";
  const raw = parts.join("-").toUpperCase();
  const cleaned = raw
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64)
    .replace(/[-_]+$/g, "");
  return cleaned;
}

function translateError(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.products.variants.form">>,
): string {
  const known = [
    "sku_too_short",
    "sku_too_long",
    "sku_invalid",
    "sku_exists",
    "color_too_long",
    "size_too_long",
    "barcode_too_long",
    "price_must_be_integer",
    "price_negative",
    "price_too_high",
    "old_price_must_be_integer",
    "old_price_negative",
    "old_price_too_high",
    "old_price_must_exceed_price",
    "weight_must_be_integer",
    "weight_negative",
    "weight_too_high",
    "invalid_body",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`errors.${key as (typeof known)[number]}`);
  }
  return t("errors.generic");
}
