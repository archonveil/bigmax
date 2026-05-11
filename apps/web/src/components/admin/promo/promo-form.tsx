"use client";

/**
 * `<PromoForm>` (P7-T1) — create/edit форма для промокода.
 *
 * Особенности:
 *  - `type` выбирается из `PROMO_TYPES` (percent / fixed / free_delivery);
 *    label поля `value` и валидация меняются в зависимости от типа.
 *  - `code` авто-UPPER на blur, чтобы UX соответствовал серверной нормализации.
 *  - `startsAt`/`endsAt` — `datetime-local` инпуты; пустая строка = null
 *    (бессрочный промо).
 *  - В edit-режиме показывается счётчик использования (`usedCount`/`usageLimit`)
 *    и кнопка удаления.
 */

import { Link, useRouter } from "@bigmax/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PROMO_TYPES, type PromoType } from "@/cart/promo";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminPromoListItem } from "@/server/admin-promo";

type Mode = "create" | "edit";

interface FormState {
  code: string;
  type: PromoType;
  /** Хранится как string (input value); конвертируется в number на submit. */
  value: string;
  minOrderCents: string;
  startsAt: string; // `datetime-local` (без timezone) или ""
  endsAt: string;
  usageLimit: string; // "" = unlimited
  isActive: boolean;
}

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  // Конвертируем UTC → local для отображения, обрезаем секунды (для `datetime-local`).
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  // Браузерный `datetime-local` отдаёт `YYYY-MM-DDTHH:mm` без timezone.
  // Интерпретируем как local time, конвертируем в ISO с offset.
  const local = new Date(v);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function init(p?: AdminPromoListItem): FormState {
  return {
    code: p?.code ?? "",
    type: (p?.type as PromoType | undefined) ?? "percent",
    value: p ? String(p.value) : "",
    minOrderCents: p ? String(p.minOrderCents) : "0",
    startsAt: toLocalInput(p?.startsAt ?? null),
    endsAt: toLocalInput(p?.endsAt ?? null),
    usageLimit: p?.usageLimit ? String(p.usageLimit) : "",
    isActive: p?.isActive ?? true,
  };
}

export function PromoForm({
  mode,
  promo,
}: {
  mode: Mode;
  promo?: AdminPromoListItem;
}): JSX.Element {
  const t = useTranslations("admin.promo.form");
  const tTypes = useTranslations("admin.promo.types");
  const tErr = useTranslations("admin.promo.errors");
  const router = useRouter();

  const [state, setState] = useState<FormState>(() => init(promo));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const onTypeChange = (next: PromoType): void => {
    setState((s) => ({
      ...s,
      type: next,
      // При смене типа обнуляем value, т.к. semantics меняется (% vs тийны).
      value: next === "free_delivery" ? "0" : "",
    }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const valueNum = Number.parseInt(state.value || "0", 10);
    const minOrderNum = Number.parseInt(state.minOrderCents || "0", 10);
    const usageLimitNum = state.usageLimit === "" ? null : Number.parseInt(state.usageLimit, 10);

    if (!Number.isFinite(valueNum) || valueNum < 0) {
      setError(tErr("value_invalid"));
      setSubmitting(false);
      return;
    }

    const body = {
      code: state.code,
      type: state.type,
      value: valueNum,
      minOrderCents: Number.isFinite(minOrderNum) && minOrderNum >= 0 ? minOrderNum : 0,
      startsAt: fromLocalInput(state.startsAt),
      endsAt: fromLocalInput(state.endsAt),
      usageLimit: usageLimitNum,
      isActive: state.isActive,
    };

    try {
      const url = mode === "create" ? "/api/admin/promo" : `/api/admin/promo/${promo!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as { id: string };
        toast.success(mode === "create" ? t("created") : t("updated"));
        if (mode === "create") {
          router.push(`/admin/promo/${data.id}` as never);
        } else {
          router.refresh();
        }
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as {
        reason?: string;
        message?: string;
      };
      const key = errBody.message ?? errBody.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!promo) return;
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/promo/${promo.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("deleted"));
        router.push("/admin/promo" as never);
        return;
      }
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const valueLabelKey: "valueLabel.percent" | "valueLabel.fixed" | "valueLabel.free_delivery" =
    `valueLabel.${state.type}` as const;

  return (
    <form onSubmit={onSubmit} className="space-y-5" data-testid="promo-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pcode">{t("fields.code")}</Label>
          <Input
            id="pcode"
            data-testid="promo-form-code"
            required
            minLength={3}
            maxLength={64}
            pattern="^[A-Za-z0-9_\-]+$"
            value={state.code}
            onChange={(e) => update("code", e.target.value)}
            onBlur={(e) => update("code", e.target.value.toUpperCase())}
            disabled={submitting}
            className="font-mono uppercase"
          />
          <p className="text-xs text-muted-foreground">{t("fields.codeHint")}</p>
        </div>

        <div>
          <Label htmlFor="ptype">{t("fields.type")}</Label>
          <Select
            value={state.type}
            onValueChange={(v) => onTypeChange(v as PromoType)}
            disabled={submitting}
          >
            <SelectTrigger id="ptype" data-testid="promo-form-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMO_TYPES.map((tt) => (
                <SelectItem key={tt} value={tt}>
                  {tTypes(tt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="pvalue">{t(valueLabelKey)}</Label>
          <Input
            id="pvalue"
            data-testid="promo-form-value"
            type="number"
            min={0}
            max={state.type === "percent" ? 100 : 1_000_000_000}
            step={1}
            required={state.type !== "free_delivery"}
            value={state.value}
            onChange={(e) => update("value", e.target.value)}
            disabled={submitting || state.type === "free_delivery"}
          />
          <p className="text-xs text-muted-foreground">{t(`valueHint.${state.type}`)}</p>
        </div>

        <div>
          <FieldLabel htmlFor="pminorder" optional>
            {t("fields.minOrder")}
          </FieldLabel>
          <Input
            id="pminorder"
            data-testid="promo-form-min-order"
            type="number"
            min={0}
            step={100}
            value={state.minOrderCents}
            onChange={(e) => update("minOrderCents", e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{t("fields.minOrderHint")}</p>
        </div>

        <div>
          <FieldLabel htmlFor="pstart" optional>
            {t("fields.startsAt")}
          </FieldLabel>
          <Input
            id="pstart"
            data-testid="promo-form-starts-at"
            type="datetime-local"
            value={state.startsAt}
            onChange={(e) => update("startsAt", e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <FieldLabel htmlFor="pend" optional>
            {t("fields.endsAt")}
          </FieldLabel>
          <Input
            id="pend"
            data-testid="promo-form-ends-at"
            type="datetime-local"
            value={state.endsAt}
            onChange={(e) => update("endsAt", e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <FieldLabel htmlFor="plimit" optional>
            {t("fields.usageLimit")}
          </FieldLabel>
          <Input
            id="plimit"
            data-testid="promo-form-usage-limit"
            type="number"
            min={1}
            step={1}
            placeholder={t("fields.usageLimitUnlimited")}
            value={state.usageLimit}
            onChange={(e) => update("usageLimit", e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{t("fields.usageLimitHint")}</p>
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="promo-form-is-active"
              checked={state.isActive}
              onChange={(e) => update("isActive", e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-input"
            />
            <span>{t("fields.isActive")}</span>
          </label>
        </div>
      </div>

      {mode === "edit" && promo ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {promo.usageLimit === null
            ? t("usageUnlimited", { used: promo.usedCount })
            : t("usageOfLimit", { used: promo.usedCount, limit: promo.usageLimit })}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" data-testid="promo-form-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="promo-form-submit">
          {submitting ? t("submitting") : mode === "create" ? t("create") : t("submit")}
        </Button>
        <Button asChild type="button" variant="outline" disabled={submitting}>
          <Link href={"/admin/promo" as never}>{t("cancel")}</Link>
        </Button>
        {mode === "edit" ? (
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void onDelete()}
            data-testid="promo-form-delete"
            className="ml-auto"
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
  t: ReturnType<typeof useTranslations<"admin.promo.errors">>,
): string {
  const known = [
    "code_too_short",
    "code_too_long",
    "code_invalid",
    "code_exists",
    "percent_out_of_range",
    "ends_before_starts",
    "value_required_when_type_changes",
    "value_invalid",
    "invalid_body",
    "not_found",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
