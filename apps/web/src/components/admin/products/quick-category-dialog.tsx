"use client";

/**
 * `<QuickCategoryDialog>` — самая простая inline-форма создания категории:
 *  - Один обязательный input — название (RU).
 *  - Slug отображается под input'ом мелким шрифтом, кликабельный, чтобы
 *    раскрыть редактор. Автогенерируется через `slugify`.
 *  - UZ / EN переводы в свернутой секции `<details>` — не мешают если
 *    admin не нужны (RU-fallback всё равно работает).
 *  - Parent-категория тоже свернута.
 *
 * Submit → POST `/api/admin/categories` → onCreated({id, nameRu, slug}).
 */

import { ChevronDown, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { slugify } from "@/lib/slugify";

interface ParentOption {
  id: string;
  nameRu: string;
}

interface QuickCategoryDialogProps {
  parents: ParentOption[];
  trigger?: React.ReactNode;
  onCreated: (cat: { id: string; nameRu: string; slug: string }) => void;
  /** Controlled-mode: оба обязательны, чтобы открывать программно. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface State {
  nameRu: string;
  nameUz: string;
  nameEn: string;
  slug: string;
  slugTouched: boolean;
  slugEditing: boolean;
  parentId: string;
}

const EMPTY: State = {
  nameRu: "",
  nameUz: "",
  nameEn: "",
  slug: "",
  slugTouched: false,
  slugEditing: false,
  parentId: "",
};

export function QuickCategoryDialog({
  parents,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: QuickCategoryDialogProps): JSX.Element {
  const t = useTranslations("admin.products.quickCreate.category");
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

  const onNameRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      nameRu: v,
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
      nameRu: state.nameRu.trim(),
      nameUz: state.nameUz.trim(),
      nameEn: state.nameEn.trim(),
      slug: state.slug.trim(),
      parentId: state.parentId === "" ? null : state.parentId,
      isActive: true,
      order: 0,
    };

    // Optimistic: закрываем dialog сразу — toast.promise держит юзера в курсе
    // в фоне. На server-error reset state и реоткрываем dialog с ошибкой.
    setSubmitting(true);
    setError(null);
    setOpen(false);
    reset();

    const request = fetch("/api/admin/categories", {
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
      if (res.ok && data.ok && data.id && data.slug) {
        onCreated({ id: data.id, nameRu: body.nameRu, slug: data.slug });
        return body.nameRu;
      }
      throw new Error(data.reason ?? "generic");
    });

    // Один toast со стабильным id, который обновляется в три фазы:
    // loading → success/error. Stable id означает, что повторный submit
    // обновит ту же нотификацию вместо стэка.
    const toastId = "quick-category";
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
              data-testid="quick-create-category-trigger"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("trigger")}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Single primary input — name (RU) */}
          <div className="space-y-1.5">
            <Label htmlFor="qcat-name-ru" className="text-sm font-medium">
              {t("fields.name")}{" "}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="qcat-name-ru"
              required
              minLength={2}
              maxLength={200}
              autoFocus
              value={state.nameRu}
              onChange={(e) => onNameRuChange(e.target.value)}
              disabled={submitting}
              placeholder={t("placeholders.name")}
            />
            {/* Slug — inline, secondary, expandable. */}
            <SlugLine
              slug={state.slug}
              editing={state.slugEditing}
              onToggle={() => setState((s) => ({ ...s, slugEditing: !s.slugEditing }))}
              onChange={onSlugChange}
              disabled={submitting}
              labelEdit={t("editSlug")}
            />
          </div>

          {/* Translations — collapsed by default */}
          <Disclosure summary={t("disclosure.translations")}>
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="qcat-name-uz" className="text-xs text-muted-foreground">
                  UZ
                </Label>
                <Input
                  id="qcat-name-uz"
                  maxLength={200}
                  value={state.nameUz}
                  onChange={(e) => setState((s) => ({ ...s, nameUz: e.target.value }))}
                  disabled={submitting}
                  placeholder={state.nameRu}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qcat-name-en" className="text-xs text-muted-foreground">
                  EN
                </Label>
                <Input
                  id="qcat-name-en"
                  maxLength={200}
                  value={state.nameEn}
                  onChange={(e) => setState((s) => ({ ...s, nameEn: e.target.value }))}
                  disabled={submitting}
                  placeholder={state.nameRu}
                />
              </div>
            </div>
          </Disclosure>

          {/* Parent — collapsed by default */}
          {parents.length > 0 ? (
            <Disclosure summary={t("disclosure.parent")}>
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="qcat-parent" className="text-xs text-muted-foreground">
                  {t("fields.parent")}
                </Label>
                <Select
                  value={state.parentId === "" ? "__none__" : state.parentId}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, parentId: v === "__none__" ? "" : v }))
                  }
                  disabled={submitting}
                >
                  <SelectTrigger id="qcat-parent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("fields.parentNone")}</SelectItem>
                    {parents.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nameRu}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Disclosure>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" data-testid="quick-create-category-error">
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
            <Button type="submit" disabled={submitting} data-testid="quick-create-category-submit">
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

// ---------------------------------------------------------------------------
// SlugLine — slug-display with click-to-edit affordance.
// ---------------------------------------------------------------------------

export function SlugLine({
  slug,
  editing,
  onToggle,
  onChange,
  disabled,
  labelEdit,
}: {
  slug: string;
  editing: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  disabled: boolean;
  labelEdit: string;
}): JSX.Element {
  if (editing) {
    return (
      <Input
        type="text"
        autoFocus
        required
        minLength={2}
        maxLength={64}
        pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
        value={slug}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onToggle}
        disabled={disabled}
        className="h-7 font-mono text-xs"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="text-left text-[11px] text-muted-foreground hover:text-foreground"
    >
      <span className="font-mono">{slug || "—"}</span>{" "}
      <span className="underline-offset-2 hover:underline">· {labelEdit}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Disclosure — animated collapsible section.
// ---------------------------------------------------------------------------

export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <details className="group rounded-md border bg-muted/20 px-3 py-2 [&[open]_svg]:rotate-180">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform" aria-hidden />
      </summary>
      {children}
    </details>
  );
}
