"use client";

/**
 * `<OrderStatusChanger>` (P6-T5) — UI для смены статуса. Доступные
 * переходы рендерятся как radio-buttons; reason — опциональный textarea.
 * Submit → `POST /api/admin/orders/[id]/status` → `router.refresh()`
 * (page-level revalidation подтянет новый статус и payments).
 */

import type { OrderStatus } from "@bigmax/db";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  orderId: string;
  current: OrderStatus;
  allowed: ReadonlyArray<OrderStatus>;
}

export function OrderStatusChanger({ orderId, current, allowed }: Props): JSX.Element {
  const t = useTranslations("admin.orders.status");
  const tStatus = useTranslations("admin.orders.statuses");
  const tErr = useTranslations("admin.orders.errors");
  const router = useRouter();
  const [target, setTarget] = useState<OrderStatus | "">(allowed[0] ?? "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return (
      <p
        className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
        data-testid="order-status-no-transitions"
      >
        {t("noTransitions", { status: tStatus(current) })}
      </p>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || target === "") return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: target,
          ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
        }),
      });
      if (res.ok) {
        toast.success(t("successTitle"), {
          description: t("successBody", { status: tStatus(target as OrderStatus) }),
        });
        setReason("");
        router.refresh();
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string };
      const key = errBody.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border p-4"
      data-testid="order-status-changer"
    >
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("current", { status: tStatus(current) })}</p>
      <fieldset>
        <legend className="sr-only">{t("to")}</legend>
        <RadioGroup
          value={target}
          onValueChange={(v) => setTarget(v as OrderStatus)}
          disabled={submitting}
          className="flex flex-wrap gap-2"
        >
          {allowed.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              data-testid={`order-status-target-${s}`}
            >
              <RadioGroupItem value={s} />
              <span>{tStatus(s)}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <div>
        <Label htmlFor="reason">{t("reasonLabel")}</Label>
        <textarea
          id="reason"
          data-testid="order-status-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={t("reasonPlaceholder")}
          disabled={submitting}
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" data-testid="order-status-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting} data-testid="order-status-submit">
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.orders.errors">>,
): string {
  const known = ["invalid_body", "illegal_transition", "status_unchanged", "not_found"] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
