"use client";

/**
 * `<RefundDialog>` (P6-T6) — модалка возврата средств. Принимает payment
 * с `refundableRemaining` (cents) — admin вводит сумму (в рублях/UZS) и
 * причину; submit → POST → `toast` + `router.refresh()`. Default-сумма
 * заполнена остатком (full refund в один клик).
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RefundResponse {
  ok: boolean;
  reason?: string;
  message?: string;
  remaining?: number;
  refundableRemaining?: number;
  paymentStatus?: string;
}

interface Props {
  paymentId: string;
  refundableRemaining: number;
  currency: string;
}

export function RefundDialog({ paymentId, refundableRemaining, currency }: Props): JSX.Element {
  const t = useTranslations("admin.payments.refund");
  const tErr = useTranslations("admin.payments.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(String(refundableRemaining / 100));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const amountNum = Number.parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError(tErr("invalid_amount"));
      return;
    }
    const amountCents = Math.round(amountNum * 100);
    if (amountCents > refundableRemaining) {
      setError(tErr("amount_exceeds_remaining"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as RefundResponse;
      if (res.ok && body.ok) {
        toast.success(t("successTitle"), {
          description: t("successBody", {
            amount: (amountCents / 100).toLocaleString("ru-RU"),
            currency,
          }),
        });
        setOpen(false);
        setReason("");
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" data-testid="payment-refund-trigger">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" data-testid="payment-refund-form">
          <p className="text-sm text-muted-foreground">
            {t("remaining", {
              amount: (refundableRemaining / 100).toLocaleString("ru-RU"),
              currency,
            })}
          </p>
          <div>
            <Label htmlFor="refund-amount">{t("amount", { currency })}</Label>
            <Input
              id="refund-amount"
              type="number"
              step="0.01"
              min="0.01"
              max={String(refundableRemaining / 100)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              required
              data-testid="payment-refund-amount"
            />
          </div>
          <div>
            <Label htmlFor="refund-reason">{t("reason")}</Label>
            <textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              required
              minLength={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
              data-testid="payment-refund-reason"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="payment-refund-error">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting}
              data-testid="payment-refund-submit"
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.payments.errors">>,
): string {
  const known = [
    "invalid_body",
    "not_refundable",
    "amount_exceeds_remaining",
    "payment_not_found",
    "provider_error",
    "provider_misconfigured",
    "reason_too_short",
    "reason_too_long",
    "invalid_amount",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}
