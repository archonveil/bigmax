"use client";

/**
 * P7-T2 sub-task G · `<FeatureForm>` — типизированный edit feature value.
 *
 * Input — type-aware:
 *   - number  → `<Input type=number>` со step=any.
 *   - boolean → radio group `true`/`false`.
 *   - string  → `<Input type=text>`.
 *
 * `type` row'ы не редактируется через UI — это invariant'ы кода (см.
 * server/admin-features.ts header). Поэтому форма принимает только `value`.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isHighRiskFeatureChange } from "@/lib/feature-risk";

type FeatureType = "number" | "boolean" | "string";

interface Props {
  featureKey: string;
  type: FeatureType;
  currentValue: string;
  description: string | null;
}

export function FeatureForm({ featureKey, type, currentValue, description }: Props): JSX.Element {
  const t = useTranslations("admin.features.form");
  const tConfirm = useTranslations("admin.features.confirm");
  const tErr = useTranslations("admin.features.errors");
  const router = useRouter();
  const [value, setValue] = useState(currentValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FF-003: pending confirmation для high-risk изменений. Когда не null —
  // открыт AlertDialog. confirm → продолжает submission, cancel → закрыть.
  const [pendingConfirm, setPendingConfirm] = useState(false);

  /** Извлечено в отдельную функцию чтобы вызываться и из onSubmit, и из
   *  onConfirm. PATCH + error-handling одинаковые в обоих случаях. */
  const performSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/features/${encodeURIComponent(featureKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (res.ok && body.ok) {
        toast.success(t("updated"));
        router.refresh();
        return;
      }
      const key = body.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * FF-003: gate submit through AlertDialog для high-risk changes. Если
   * `isHighRiskFeatureChange(key, value)` — открываем confirmation,
   * иначе сразу `performSubmit`.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting || pendingConfirm) return;
    if (value === currentValue) return; // no-op
    if (isHighRiskFeatureChange(featureKey, value)) {
      setPendingConfirm(true);
      return;
    }
    void performSubmit();
  };

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border bg-card p-5"
        data-testid="feature-form"
      >
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

        <div className="space-y-1.5">
          <Label htmlFor="feature-value">{t(`valueLabel.${type}`)}</Label>
          {type === "boolean" ? (
            <fieldset className="flex gap-4" data-testid="feature-form-boolean">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="feature-value"
                  value="true"
                  checked={value === "true"}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={submitting}
                  className="h-4 w-4"
                />
                <span>{t("boolean.true")}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="feature-value"
                  value="false"
                  checked={value === "false"}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={submitting}
                  className="h-4 w-4"
                />
                <span>{t("boolean.false")}</span>
              </label>
            </fieldset>
          ) : (
            <Input
              id="feature-value"
              data-testid="feature-form-value"
              type={type === "number" ? "number" : "text"}
              step={type === "number" ? "any" : undefined}
              inputMode={type === "number" ? "decimal" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
              // P7-T2 sub-task O: для type=string пустое — легитимное «выключить»
              // (например, brand.maintenance_message=""=banner скрыт). Только number
              // требует non-empty (NaN — это validation error на сервере).
              required={type === "number"}
              maxLength={2000}
              className="font-mono"
            />
          )}
          <p className="text-xs text-muted-foreground">{t(`hint.${type}`)}</p>
        </div>

        {error ? (
          <p className="text-sm text-destructive" data-testid="feature-form-error">
            {error}
          </p>
        ) : null}

        <footer className="flex flex-wrap gap-3 border-t pt-4">
          <Button type="submit" disabled={submitting} data-testid="feature-form-submit">
            {submitting ? t("submitting") : t("submit")}
          </Button>
          <Button asChild type="button" variant="outline" disabled={submitting}>
            {/* Locale-aware navigation handled by parent <Link>; here just a fallback. */}
            <a href="../features">{t("cancel")}</a>
          </Button>
        </footer>
      </form>

      {/* FF-003: AlertDialog для high-risk изменений. open-state управляется
        `pendingConfirm`; cancel закрывает, action продолжает PATCH. */}
      <AlertDialog
        open={pendingConfirm}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(false);
        }}
      >
        <AlertDialogContent data-testid="feature-form-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{tConfirm("title")}</AlertDialogTitle>
            <AlertDialogDescription>{tConfirm("body", { key: featureKey })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground"
            data-testid="feature-form-confirm-diff"
          >
            <span className="line-through opacity-70">{currentValue}</span>
            <span className="mx-1.5">→</span>
            <span className="text-foreground">{value}</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="feature-form-confirm-cancel">
              {tConfirm("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feature-form-confirm-proceed"
              onClick={() => {
                setPendingConfirm(false);
                void performSubmit();
              }}
            >
              {tConfirm("proceed")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.features.errors">>,
): string {
  const known = [
    "invalid_body",
    "invalid_number",
    "invalid_boolean",
    "empty_string",
    "not_found",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
