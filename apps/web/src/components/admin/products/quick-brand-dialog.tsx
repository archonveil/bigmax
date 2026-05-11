"use client";

/**
 * `<QuickBrandDialog>` — самая простая inline-форма создания бренда:
 *   - Один обязательный input — название.
 *   - Slug в свернутом inline-виде, click-to-edit.
 *   - Country свернута в `<details>`-секцию.
 */

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Disclosure, SlugLine } from "@/components/admin/products/quick-category-dialog";
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

interface QuickBrandDialogProps {
  trigger?: React.ReactNode;
  onCreated: (brand: { id: string; name: string; slug: string }) => void;
  /** Controlled-mode: оба обязательны, чтобы открывать программно. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface State {
  name: string;
  slug: string;
  slugTouched: boolean;
  slugEditing: boolean;
  country: string;
}

const EMPTY: State = {
  name: "",
  slug: "",
  slugTouched: false,
  slugEditing: false,
  country: "",
};

export function QuickBrandDialog({
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: QuickBrandDialogProps): JSX.Element {
  const t = useTranslations("admin.products.quickCreate.brand");
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

  const onNameChange = (v: string): void => {
    setState((s) => ({
      ...s,
      name: v,
      slug: s.slugTouched ? s.slug : slugify(v, { separator: "-", maxLength: 64 }),
    }));
  };

  const onSlugChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setState((s) => ({ ...s, slug: cleaned, slugTouched: cleaned.length > 0 }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting) return;
    const body = {
      name: state.name.trim(),
      slug: state.slug.trim(),
      country: state.country.trim() === "" ? null : state.country.trim(),
    };

    setSubmitting(true);
    setError(null);
    setOpen(false);
    reset();

    const request = fetch("/api/admin/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        slug?: string;
        reason?: string;
      };
      if (res.ok && data.ok && data.id) {
        const slug = data.slug ?? body.slug;
        onCreated({ id: data.id, name: body.name, slug });
        return body.name;
      }
      throw new Error(data.reason ?? "generic");
    });

    // Один toast со стабильным id, который обновляется в три фазы:
    // loading → success/error. Stable id означает, что повторный submit
    // обновит ту же нотификацию вместо стэка.
    const toastId = "quick-brand";
    toast.loading(t("submitting"), { id: toastId });
    request
      .then(
        (name) => toast.success(t("success", { name }), { id: toastId }),
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
              data-testid="quick-create-brand-trigger"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("trigger")}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Single primary input — name */}
          <div className="space-y-1.5">
            <Label htmlFor="qbrand-name" className="text-sm font-medium">
              {t("fields.name")}{" "}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="qbrand-name"
              required
              minLength={2}
              maxLength={120}
              autoFocus
              value={state.name}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={submitting}
              placeholder={t("placeholders.name")}
            />
            <SlugLine
              slug={state.slug}
              editing={state.slugEditing}
              onToggle={() => setState((s) => ({ ...s, slugEditing: !s.slugEditing }))}
              onChange={onSlugChange}
              disabled={submitting}
              labelEdit={t("editSlug")}
            />
          </div>

          <Disclosure summary={t("disclosure.advanced")}>
            <div className="space-y-1.5 pt-2">
              <Label htmlFor="qbrand-country" className="text-xs text-muted-foreground">
                {t("fields.country")}
              </Label>
              <Input
                id="qbrand-country"
                maxLength={64}
                value={state.country}
                onChange={(e) => setState((s) => ({ ...s, country: e.target.value }))}
                disabled={submitting}
              />
            </div>
          </Disclosure>

          {error ? (
            <p className="text-sm text-destructive" data-testid="quick-create-brand-error">
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
            <Button type="submit" disabled={submitting} data-testid="quick-create-brand-submit">
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
