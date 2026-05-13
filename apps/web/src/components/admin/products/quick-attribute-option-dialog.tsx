"use client";

/**
 * `<QuickAttributeOptionDialog>` — самая маленькая inline-форма: добавить
 * НОВОЕ ЗНАЧЕНИЕ в существующий enum/multiselect-атрибут, не уходя с
 * страницы продукта.
 *
 * Один обязательный input — label (RU). Value авто-генерируется через
 * `slugify(separator: "_")` и показывается inline, click-to-edit. UZ/EN
 * переводы — в свернутой `<details>` секции (RU-fallback на read-стороне).
 *
 * Сабмит → PATCH `/api/admin/categories/{parentCategoryId}/attributes/{attrId}`
 * с новым `options`-массивом ([...старые, новый]). После успеха вызывает
 * `onCreated(value)` — caller может авто-подставить новое значение в
 * product.attributes.
 *
 * Note: атрибут может быть унаследован из родительской категории. В этом
 * случае мы дёргаем endpoint родительской — изменение распространится на
 * все наследующие категории. UI hint об этом не показываем (admin сам
 * выбирает категорию своему product'у; option нужен ему именно в этом
 * shared-словаре).
 */

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { AttributeOption } from "@/catalog/category-attributes";
import { SlugLine } from "@/components/admin/products/quick-category-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slugify";

interface QuickAttributeOptionDialogProps {
  /** Категория, на которой ОПРЕДЕЛЁН этот атрибут (может != product.categoryId
   *  если атрибут наследуется). */
  attributeCategoryId: string;
  attributeId: string;
  attributeLabel: string;
  existingOptions: readonly AttributeOption[];
  /** Если не передан — рендерится дефолтный outline-кнопка. */
  trigger?: React.ReactNode;
  onCreated: (option: AttributeOption) => void;
  /** Controlled-mode: оба обязательны, чтобы открывать программно (без trigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface State {
  labelRu: string;
  labelUz: string;
  labelEn: string;
  value: string;
  valueTouched: boolean;
  valueEditing: boolean;
}

const EMPTY: State = {
  labelRu: "",
  labelUz: "",
  labelEn: "",
  value: "",
  valueTouched: false,
  valueEditing: false,
};

export function QuickAttributeOptionDialog({
  attributeCategoryId,
  attributeId,
  attributeLabel,
  existingOptions,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: QuickAttributeOptionDialogProps): JSX.Element {
  const t = useTranslations("admin.products.quickCreate.option");
  const isControlled = controlledOpen !== undefined && controlledOnOpenChange !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean): void => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [state, setState] = useState<State>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setState(EMPTY);
    setError(null);
  };

  const onLabelRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      labelRu: v,
      value: s.valueTouched ? s.value : slugify(v, { separator: "_", maxLength: 64 }),
    }));
  };

  const onValueChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    setState((s) => ({ ...s, value: cleaned, valueTouched: cleaned.length > 0 }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (submitting) return;

    const labelRu = state.labelRu.trim();
    const value = state.value.trim();
    if (labelRu === "" || value === "") {
      setError(t("errors.required"));
      return;
    }
    if (existingOptions.some((o) => o.value.toLowerCase() === value.toLowerCase())) {
      setError(t("errors.duplicate"));
      return;
    }

    const newOption: AttributeOption = {
      value,
      labelRu,
      labelUz: state.labelUz.trim() || labelRu,
      labelEn: state.labelEn.trim() || labelRu,
    };
    const nextOptions = [...existingOptions, newOption];

    setSubmitting(true);
    setError(null);
    setOpen(false);
    reset();

    // Optimistic: фиксируем выбор в товаре сразу — admin видит новое
    // значение в editor'е немедленно, до response.
    onCreated(newOption);

    const request = fetch(
      `/api/admin/categories/${attributeCategoryId}/attributes/${attributeId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: nextOptions }),
      },
    ).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        message?: string;
      };
      if (res.ok && data.ok) return labelRu;
      throw new Error(data.message ?? data.reason ?? "generic");
    });

    // Один toast со стабильным id, который обновляется в три фазы:
    // loading → success/error.
    const toastId = "quick-attribute-option";
    toast.loading(t("submitting"), { id: toastId });
    request
      .then(
        (label) => toast.success(t("success", { label }), { id: toastId }),
        () => toast.error(t("errors.generic"), { id: toastId }),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {isControlled ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="quick-create-option-trigger"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("trigger")}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("title", { attribute: attributeLabel })}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Single primary input — label (RU) */}
          <div className="space-y-1.5">
            <Label htmlFor="qopt-label-ru" className="text-sm font-medium">
              {t("fields.label")}{" "}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="qopt-label-ru"
              required
              minLength={1}
              maxLength={80}
              autoFocus
              value={state.labelRu}
              onChange={(e) => onLabelRuChange(e.target.value)}
              disabled={submitting}
              placeholder={t("placeholders.label")}
            />
            <SlugLine
              slug={state.value}
              editing={state.valueEditing}
              onToggle={() => setState((s) => ({ ...s, valueEditing: !s.valueEditing }))}
              onChange={onValueChange}
              disabled={submitting}
              labelEdit={t("editValue")}
            />
          </div>

          <details className="group rounded-md border bg-muted/20 px-3 py-2 [&[open]_svg]:rotate-180">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span>{t("disclosureTranslations")}</span>
              <svg
                className="h-3.5 w-3.5 transition-transform"
                viewBox="0 0 20 20"
                aria-hidden
                fill="currentColor"
              >
                <path d="M6 8l4 4 4-4" />
              </svg>
            </summary>
            <div className="space-y-2 pt-2">
              <div className="space-y-1">
                <Label htmlFor="qopt-label-uz" className="text-xs text-muted-foreground">
                  UZ
                </Label>
                <Input
                  id="qopt-label-uz"
                  maxLength={80}
                  value={state.labelUz}
                  onChange={(e) => setState((s) => ({ ...s, labelUz: e.target.value }))}
                  disabled={submitting}
                  placeholder={state.labelRu}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qopt-label-en" className="text-xs text-muted-foreground">
                  EN
                </Label>
                <Input
                  id="qopt-label-en"
                  maxLength={80}
                  value={state.labelEn}
                  onChange={(e) => setState((s) => ({ ...s, labelEn: e.target.value }))}
                  disabled={submitting}
                  placeholder={state.labelRu}
                />
              </div>
            </div>
          </details>

          {error ? (
            <p className="text-sm text-destructive" data-testid="quick-create-option-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="quick-create-option-submit">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {t("submitting")}
                </>
              ) : (
                t("submit")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
