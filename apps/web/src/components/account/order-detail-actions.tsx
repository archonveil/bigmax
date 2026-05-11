"use client";

/**
 * Кнопки действий на детальной странице заказа (P5-T2):
 *   - **Re-order** — POST `/api/account/orders/[id]/reorder`, на ответ
 *     добавляет items в `useCart` и редиректит на /cart с toast'ом.
 *   - **Refund** — открывает диалог с `<textarea reason>`, при submit'е POST
 *     на `/api/account/orders/[id]/refund`. Показывает success/error inline.
 *
 * Eligibility приходит из SSR (см. `validateRefundEligibility`). Если не-eligible —
 * кнопка disabled + tooltip-message с причиной.
 */

import type { Locale } from "@bigmax/shared-types";
import { Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { useCart } from "@/cart/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type EligibilityProp =
  | { eligible: true; paymentId: string; amountCents: number }
  | {
      eligible: false;
      reason:
        | "no_captured_payment"
        | "order_cancelled"
        | "refund_already_requested"
        | "refund_already_completed";
    };

type CancelEligibilityProp =
  | {
      eligible: true;
      capturedPayment: {
        id: string;
        billnumber: string | null;
        orderIdp: string | null;
      } | null;
    }
  | {
      eligible: false;
      reason: "order_too_late" | "order_already_cancelled" | "refund_in_progress";
    };

interface ReorderItem {
  variantId: string;
  productId: string;
  productSlug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  priceCents: number;
  oldPriceCents: number | null;
  quantity: number;
}

export function OrderDetailActions({
  orderId,
  eligibility,
  cancelEligibility,
  locale,
}: {
  orderId: string;
  eligibility: EligibilityProp;
  cancelEligibility: CancelEligibilityProp;
  locale: Locale;
}): JSX.Element {
  const t = useTranslations("account.orders.detail.actions");
  const tIneligible = useTranslations("account.orders.detail.actions.refundIneligible");
  const tCancelIneligible = useTranslations("account.orders.detail.actions.cancelIneligible");

  return (
    <section
      className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-start sm:flex-wrap"
      data-testid="detail-actions"
    >
      <ReorderButton orderId={orderId} label={t("reorder")} progress={t("reorderInProgress")} />
      <RefundButton
        orderId={orderId}
        eligibility={eligibility}
        locale={locale}
        labels={{
          requestLabel: t("refund"),
          ineligible: {
            no_captured_payment: tIneligible("no_captured_payment"),
            order_cancelled: tIneligible("order_cancelled"),
            refund_already_requested: tIneligible("refund_already_requested"),
            refund_already_completed: tIneligible("refund_already_completed"),
          },
        }}
      />
      <CancelButton
        orderId={orderId}
        eligibility={cancelEligibility}
        labels={{
          cancelLabel: t("cancel"),
          ineligible: {
            order_too_late: tCancelIneligible("order_too_late"),
            order_already_cancelled: tCancelIneligible("order_already_cancelled"),
            refund_in_progress: tCancelIneligible("refund_in_progress"),
          },
        }}
      />
    </section>
  );
  void locale; // formatCurrency'd inside refund dialog if needed in future
}

// ---------------------------------------------------------------------------
// Re-order
// ---------------------------------------------------------------------------

function ReorderButton({
  orderId,
  label,
  progress,
}: {
  orderId: string;
  label: string;
  progress: string;
}): JSX.Element {
  const t = useTranslations("account.orders.detail.actions");
  const router = useRouter();
  const cartAdd = useCart((s) => s.add);
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  const onClick = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/reorder`, { method: "POST" });
      if (!res.ok) {
        toast.error(t("reorderFailed"));
        return;
      }
      const body = (await res.json()) as { addedItems: ReorderItem[]; skippedCount: number };
      // Merge каждый item — useCart.add() обрабатывает inc если variant уже в cart.
      for (const item of body.addedItems) {
        cartAdd(
          {
            variantId: item.variantId,
            productId: item.productId,
            productSlug: item.productSlug,
            nameRu: item.nameRu,
            nameUz: item.nameUz,
            nameEn: item.nameEn,
            brandName: item.brandName,
            imageUrl: item.imageUrl,
            color: item.color,
            size: item.size,
            priceCents: item.priceCents,
            oldPriceCents: item.oldPriceCents,
          },
          item.quantity,
        );
      }
      if (body.addedItems.length > 0) {
        toast.success(t("reorderSuccess", { count: body.addedItems.length }));
      }
      if (body.skippedCount > 0) {
        toast.warning(t("reorderSkipped", { count: body.skippedCount }));
      }
      startTransition(() => {
        router.push("/cart");
      });
    } catch {
      toast.error(t("reorderFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Button onClick={onClick} disabled={submitting || isPending} data-testid="reorder-button">
      {submitting || isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          {progress}
        </>
      ) : (
        <>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

function RefundButton({
  orderId,
  eligibility,
  labels,
}: {
  orderId: string;
  eligibility: EligibilityProp;
  locale: Locale;
  labels: {
    requestLabel: string;
    ineligible: Record<
      | "no_captured_payment"
      | "order_cancelled"
      | "refund_already_requested"
      | "refund_already_completed",
      string
    >;
  };
}): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!eligibility.eligible) {
    return (
      <div className="flex flex-col gap-1" data-testid="refund-disabled">
        <Button variant="outline" disabled data-testid="refund-button">
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
          {labels.requestLabel}
        </Button>
        <p className="text-xs text-muted-foreground">{labels.ineligible[eligibility.reason]}</p>
      </div>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="refund-button">
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        {labels.requestLabel}
      </Button>
      <RefundDialog open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  orderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
}): JSX.Element {
  const t = useTranslations("account.orders.detail.refundDialog");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setSuccess(true);
        // НЕ refresh'аем тут — иначе SSR увидит уже-pending refund и кнопка
        // disabled, что unmount'ит наш success-state раньше чем юзер увидит.
        // Refresh откладываем до закрытия диалога юзером (handleClose).
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      const errorKey = body.message ?? body.reason ?? "generic";
      setError(translateError(errorKey, t));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (next: boolean): void => {
    if (submitting) return;
    if (!next) {
      const wasSuccess = success;
      // Reset на close
      setReason("");
      setError(null);
      setSuccess(false);
      onOpenChange(false);
      if (wasSuccess) {
        // Перезагружаем SSR — refunds-history появится, refund-кнопка
        // станет disabled на следующем рендере.
        router.refresh();
      }
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="refund-dialog">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("successTitle")}</DialogTitle>
              <DialogDescription>{t("successBody")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>OK</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("body")}</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <label htmlFor="refund-reason" className="text-sm font-medium">
                {t("reasonLabel")}
              </label>
              <textarea
                id="refund-reason"
                data-testid="refund-reason-input"
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
                placeholder={t("reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                required
                minLength={10}
                maxLength={1000}
              />
              {error ? (
                <p className="text-sm text-destructive" data-testid="refund-error">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={submitting}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={submitting} data-testid="refund-submit">
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
        )}
      </DialogContent>
    </Dialog>
  );
}

function translateError(
  key: string,
  t: ReturnType<typeof useTranslations<"account.orders.detail.refundDialog">>,
): string {
  switch (key) {
    case "reason_too_short":
      return t("errors.reason_too_short");
    case "reason_too_long":
      return t("errors.reason_too_long");
    case "invalid_body":
      return t("errors.invalid_body");
    default:
      return t("errors.generic");
  }
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

function CancelButton({
  orderId,
  eligibility,
  labels,
}: {
  orderId: string;
  eligibility: CancelEligibilityProp;
  labels: {
    cancelLabel: string;
    ineligible: Record<"order_too_late" | "order_already_cancelled" | "refund_in_progress", string>;
  };
}): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!eligibility.eligible) {
    // Тихо НЕ показываем кнопку для уже-отменённых/refunded заказов —
    // у них cancel бессмыслен. Для остальных недоступных — disabled
    // кнопка с пояснением (юзер должен понимать почему нельзя).
    if (eligibility.reason === "order_already_cancelled") {
      return <></>;
    }
    return (
      <div className="flex flex-col gap-1" data-testid="cancel-disabled">
        <Button variant="ghost" disabled data-testid="cancel-button">
          <XCircle className="mr-2 h-4 w-4" aria-hidden />
          {labels.cancelLabel}
        </Button>
        <p className="text-xs text-muted-foreground">{labels.ineligible[eligibility.reason]}</p>
      </div>
    );
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} data-testid="cancel-button">
        <XCircle className="mr-2 h-4 w-4" aria-hidden />
        {labels.cancelLabel}
      </Button>
      <CancelDialog open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  orderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
}): JSX.Element {
  const t = useTranslations("account.orders.detail.cancelDialog");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason.trim() === "" ? {} : { reason }),
      });
      if (res.ok) {
        setSuccess(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      setError(translateCancelError(body.message ?? body.reason ?? "generic", t));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (next: boolean): void => {
    if (submitting) return;
    if (!next) {
      const wasSuccess = success;
      setReason("");
      setError(null);
      setSuccess(false);
      onOpenChange(false);
      // Перезагружаем SSR на close ПОСЛЕ success — детали обновятся, кнопка
      // cancel исчезнет, OrderTracker перейдёт в terminal-cancelled.
      if (wasSuccess) router.refresh();
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="cancel-dialog">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("successTitle")}</DialogTitle>
              <DialogDescription>{t("successBody")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => handleClose(false)} data-testid="cancel-success-ok">
                OK
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("body")}</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <label htmlFor="cancel-reason" className="text-sm font-medium">
                {t("reasonLabel")}
              </label>
              <textarea
                id="cancel-reason"
                data-testid="cancel-reason-input"
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
                placeholder={t("reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                maxLength={500}
              />
              {error ? (
                <p className="text-sm text-destructive" data-testid="cancel-error">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={submitting}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={submitting}
                data-testid="cancel-submit"
              >
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
        )}
      </DialogContent>
    </Dialog>
  );
}

function translateCancelError(
  key: string,
  t: ReturnType<typeof useTranslations<"account.orders.detail.cancelDialog">>,
): string {
  switch (key) {
    case "reason_too_long":
      return t("errors.reason_too_long");
    case "invalid_body":
      return t("errors.invalid_body");
    case "order_too_late":
      return t("errors.order_too_late");
    case "order_already_cancelled":
      return t("errors.order_already_cancelled");
    case "refund_in_progress":
      return t("errors.refund_in_progress");
    case "provider_misconfigured":
      return t("errors.provider_misconfigured");
    case "provider_error":
      return t("errors.provider_error");
    default:
      return t("errors.generic");
  }
}
