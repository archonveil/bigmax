"use client";

import { Link } from "@bigmax/i18n/navigation";
import {
  formatCurrencyUzs,
  localized,
  LOYALTY_MIN_ORDER_TO_SPEND_CENTS,
  type CheckoutPayCodSuccess,
  type CheckoutPayError,
  type CheckoutPayRequest,
  type CheckoutPayUzumSuccess,
  type Locale,
} from "@bigmax/shared-types";
import { ArrowLeft, Check, Loader2, LogIn, ShoppingCart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { selectItems, selectSubtotalCents, useCart } from "@/cart/store";
import { prevStep, useCheckout } from "@/checkout/store";
import { useDeliveryEstimate } from "@/checkout/use-delivery-estimate";
import type { Branch } from "@/components/checkout/checkout-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface StepReviewProps {
  branches: Branch[];
  isAuthenticated: boolean;
  /** P7-T2: текущий баланс баллов «Бигмах Бонус» (0 для гостей). */
  loyaltyBalance: number;
  /** P7-T2 sub-task M: глобальный kill-switch `loyalty.spend_enabled`.
   *  Если false — `<LoyaltyBlock>` скрыт целиком. */
  loyaltySpendEnabled: boolean;
}

export function StepReview({
  branches,
  isAuthenticated,
  loyaltyBalance,
  loyaltySpendEnabled,
}: StepReviewProps): JSX.Element {
  const t = useTranslations("checkout.review");
  const tDelivery = useTranslations("checkout.delivery");
  const tCost = useTranslations("checkout.delivery.cost");
  const tPayment = useTranslations("checkout.payment");
  const tNav = useTranslations("checkout.nav");
  const tLoyalty = useTranslations("checkout.loyalty");
  const locale = useLocale() as Locale;

  const contacts = useCheckout((s) => s.contacts);
  const address = useCheckout((s) => s.address);
  const delivery = useCheckout((s) => s.delivery);
  const payment = useCheckout((s) => s.payment);
  const setStep = useCheckout((s) => s.setStep);
  const reset = useCheckout((s) => s.reset);
  const loyaltyPointsToSpend = useCheckout((s) => s.loyaltyPointsToSpend);
  const setLoyaltyPointsToSpend = useCheckout((s) => s.setLoyaltyPointsToSpend);
  const clearCart = useCart((s) => s.clear);
  const estimate = useDeliveryEstimate();
  const items = useCart(selectItems);
  const appliedPromo = useCart((s) => s.appliedPromo);
  // P7-T2 sub-task D: subtotal нужен для inline-hint «минимум 5_000 сум».
  // Server-side clamp авторитативен — здесь только UX-страховка.
  const subtotalCents = useCart(selectSubtotalCents);
  const [submitting, setSubmitting] = useState(false);

  // P7-T2 sub-task D: auto-clear pointsToSpend если subtotal упал ниже min'а
  // (например, юзер удалил позицию из корзины через «Изменить» на review-шаге).
  // Иначе server-clamp вернёт 0 без объяснения и юзер заметит уже после submit.
  //
  // P7-T2 sub-task M: дополнительный clear когда global kill-switch выключен —
  // юзер мог зайти на /checkout с уже-persisted `loyaltyPointsToSpend > 0`
  // в localStorage, а admin переключил `loyalty.spend_enabled = false` после.
  // OrderSummary показал бы скидку, server её бы проигнорировал.
  useEffect(() => {
    if (loyaltyPointsToSpend <= 0) return;
    if (!loyaltySpendEnabled || subtotalCents < LOYALTY_MIN_ORDER_TO_SPEND_CENTS) {
      setLoyaltyPointsToSpend(0);
    }
  }, [loyaltyPointsToSpend, subtotalCents, loyaltySpendEnabled, setLoyaltyPointsToSpend]);

  // С P4-T8 COD-метод тоже активен — никакого разделения по `isCod` в гейте.
  const canPlaceOrder =
    isAuthenticated && items.length > 0 && estimate.kind === "priced" && !submitting;

  const pickupBranch =
    delivery.method === "pickup" && delivery.branchId
      ? branches.find((b) => b.id === delivery.branchId)
      : null;

  // returnTo передаём, чтобы после login/register юзер вернулся ровно сюда.
  const loginHref = `/auth/login?returnTo=${encodeURIComponent(`/${locale}/checkout`)}`;
  const registerHref = `/auth/register?returnTo=${encodeURIComponent(`/${locale}/checkout`)}`;

  // Handler: POST /api/checkout/pay → получаем HTML self-submit формы,
  // переписываем текущий документ, браузер автосабмитит на Uniteller.
  const onPlaceOrder = async (): Promise<void> => {
    if (!canPlaceOrder) return;
    setSubmitting(true);
    try {
      const request: CheckoutPayRequest = {
        contacts: {
          name: contacts.name ?? "",
          email: contacts.email ?? "",
          phone: contacts.phone ?? "",
        },
        delivery: {
          method: (delivery.method ?? "courier") as "courier" | "pickup",
          branchId: delivery.branchId ?? "",
          comment: delivery.comment ?? "",
        },
        payment: {
          method: (payment.method ?? "uniteller") as "uniteller" | "cod" | "uzum",
        },
        items: items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
        locale,
        ...(delivery.method === "courier"
          ? {
              address: {
                region: address.region ?? "",
                city: address.city ?? "",
                district: address.district ?? "",
                street: address.street ?? "",
                house: address.house ?? "",
                apartment: address.apartment ?? "",
                landmark: address.landmark ?? "",
                phone: address.phone ?? "",
              },
            }
          : {}),
        ...(appliedPromo ? { promoCode: appliedPromo.code } : {}),
        // P7-T2: списание баллов лояльности — clamp server-side.
        ...(loyaltyPointsToSpend > 0 ? { pointsToSpend: loyaltyPointsToSpend } : {}),
      };

      const res = await fetch("/api/checkout/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const contentType = res.headers.get("content-type") ?? "";

      // Uniteller-ветка: HTML self-submit форма → переписываем документ.
      if (res.ok && contentType.includes("text/html")) {
        const html = await res.text();
        document.open();
        document.write(html);
        document.close();
        return; // документ заменён, дальше ничего не делаем
      }

      // COD-ветка: JSON с redirectTo → router.push на success-страницу.
      if (res.ok && contentType.includes("application/json")) {
        const json = (await res.json()) as CheckoutPayCodSuccess | CheckoutPayUzumSuccess;
        if (json.ok && json.provider === "cod" && json.redirectTo) {
          // Перед редиректом чистим cart + checkout-draft — они больше
          // не нужны, и юзер не должен видеть «старую» корзину при возврате.
          clearCart();
          reset();
          // `router.push` из @bigmax/i18n/navigation сам отрезает префикс
          // локали; redirectTo приходит уже с локалью → используем native.
          window.location.assign(json.redirectTo);
          return;
        }
        // Uzum-ветка: JSON с диплинком → открываем приложение Uzum Bank.
        if (json.ok && json.provider === "uzum" && json.redirectTo) {
          clearCart();
          reset();
          window.location.assign(json.redirectTo);
          return;
        }
      }

      const err = (await res.json().catch(() => null)) as CheckoutPayError | null;
      toast.error(errorMessage(err, t));
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{t("title")}</h2>

      <ReviewCard
        title={t("yourContacts")}
        onEdit={() => setStep("contacts")}
        editLabel={t("editStep")}
      >
        <p>{contacts.name}</p>
        <p className="text-muted-foreground">{contacts.email}</p>
        <p className="text-muted-foreground">{contacts.phone}</p>
      </ReviewCard>

      {delivery.method === "courier" ? (
        <ReviewCard
          title={t("deliveryAddress")}
          onEdit={() => setStep("address")}
          editLabel={t("editStep")}
        >
          <p>
            {address.region}, {address.city}
            {address.district ? `, ${address.district}` : ""}
          </p>
          <p className="text-muted-foreground">
            {address.street}, {address.house}
            {address.apartment ? `, кв. ${address.apartment}` : ""}
          </p>
          {address.landmark ? <p className="text-muted-foreground">{address.landmark}</p> : null}
        </ReviewCard>
      ) : null}

      <ReviewCard
        title={t("deliveryMethod")}
        onEdit={() => setStep("delivery")}
        editLabel={t("editStep")}
      >
        <p>
          {delivery.method === "courier" ? tDelivery("courier") : tDelivery("pickup")}
          {pickupBranch ? ` — ${localized(pickupBranch, "name", locale)}` : ""}
        </p>
        {pickupBranch ? (
          <>
            <p className="text-muted-foreground">{localized(pickupBranch, "address", locale)}</p>
            <p className="text-muted-foreground">
              {[pickupBranch.phone, pickupBranch.workingHours].filter(Boolean).join(" · ")}
            </p>
          </>
        ) : null}
        <p className="text-muted-foreground">
          {tCost("label")}: <ReviewDeliveryCost estimate={estimate} locale={locale} tCost={tCost} />
        </p>
        {delivery.comment ? <p className="text-muted-foreground">“{delivery.comment}”</p> : null}
      </ReviewCard>

      <ReviewCard
        title={t("paymentMethod")}
        onEdit={() => setStep("payment")}
        editLabel={t("editStep")}
      >
        <p>
          {payment.method === "uniteller"
            ? tPayment("card")
            : payment.method === "uzum"
              ? tPayment("uzum")
              : tPayment("cod")}
        </p>
      </ReviewCard>

      {isAuthenticated && loyaltyBalance > 0 && loyaltySpendEnabled ? (
        <LoyaltyBlock
          balance={loyaltyBalance}
          points={loyaltyPointsToSpend}
          subtotalCents={subtotalCents}
          locale={locale}
          onChange={setLoyaltyPointsToSpend}
          t={tLoyalty}
        />
      ) : null}

      {!isAuthenticated ? (
        <Alert variant="warning">
          <LogIn className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("authRequiredTitle")}</AlertTitle>
          <AlertDescription>
            <p className="mb-3">{t("authRequiredBody")}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={loginHref as never}>{t("signIn")}</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={registerHref as never}>{t("signUp")}</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStep(prevStep("review")!)}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            {tNav("back")}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link href="/cart">
              <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
              {t("backToCart")}
            </Link>
          </Button>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={onPlaceOrder}
          disabled={!canPlaceOrder}
          title={
            !isAuthenticated
              ? t("authRequiredBody")
              : estimate.kind !== "priced"
                ? t("errors.invalid_delivery")
                : undefined
          }
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Check className="mr-2 h-4 w-4" aria-hidden />
          )}
          {submitting ? t("placingOrder") : t("placeOrder")}
        </Button>
      </div>
    </section>
  );
}

interface ReviewCardProps {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: React.ReactNode;
}

function ReviewDeliveryCost({
  estimate,
  locale,
  tCost,
}: {
  estimate: ReturnType<typeof useDeliveryEstimate>;
  locale: Locale;
  tCost: ReturnType<typeof useTranslations<"checkout.delivery.cost">>;
}): JSX.Element {
  if (estimate.kind === "priced") {
    if (estimate.cents === 0) {
      return (
        <span className="text-primary">
          {tCost("free")}
          {estimate.zone === "pickup" ? "" : ` · ${etaFragment(estimate, tCost)}`}
        </span>
      );
    }
    return (
      <span className="text-foreground">
        {formatCurrencyUzs(estimate.cents, locale)} · {etaFragment(estimate, tCost)}
      </span>
    );
  }
  if (estimate.reason === "missing-region") return <span>{tCost("needsRegion")}</span>;
  if (estimate.reason === "missing-district") return <span>{tCost("needsDistrict")}</span>;
  return <span>{tCost("needsRegion")}</span>;
}

function etaFragment(
  est: Extract<ReturnType<typeof useDeliveryEstimate>, { kind: "priced" }>,
  tCost: ReturnType<typeof useTranslations<"checkout.delivery.cost">>,
): string {
  if (est.zone === "pickup") return tCost("pickupReady");
  return est.minDays === est.maxDays
    ? tCost("etaSame", { days: est.minDays })
    : tCost("etaRange", { min: est.minDays, max: est.maxDays });
}

function errorMessage(
  err: CheckoutPayError | null,
  t: ReturnType<typeof useTranslations<"checkout.review">>,
): string {
  if (!err) return t("errors.generic");
  switch (err.reason) {
    case "unauthorized":
      return t("errors.unauthorized");
    case "empty_cart":
      return t("errors.empty_cart");
    case "invalid_variant":
      return t("errors.invalid_variant");
    case "invalid_delivery":
      return t("errors.invalid_delivery");
    case "invalid_promo":
      return t("errors.invalid_promo");
    case "cod_not_implemented":
      return t("codComingBody");
    case "payment_provider_misconfigured":
      return t("errors.provider");
    case "invalid_body":
    case "internal":
    default:
      return t("errors.generic");
  }
}

function ReviewCard({ title, editLabel, onEdit, children }: ReviewCardProps): JSX.Element {
  return (
    <article className="rounded-lg border bg-card p-4">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {editLabel}
        </button>
      </header>
      <div className="space-y-0.5 text-sm">{children}</div>
    </article>
  );
}

/**
 * P7-T2: блок «Бигмах Бонус» в Review-шаге. Юзер видит баланс + поле ввода
 * количества баллов к списанию. Сервер сделает финальный clamp при checkout/pay.
 */
function LoyaltyBlock({
  balance,
  points,
  subtotalCents,
  locale,
  onChange,
  t,
}: {
  balance: number;
  points: number;
  subtotalCents: number;
  locale: Locale;
  onChange: (n: number) => void;
  t: ReturnType<typeof useTranslations<"checkout.loyalty">>;
}): JSX.Element {
  // P7-T2 sub-task D: блокируем ввод если subtotal не покрывает минимум.
  // (Server clamp всё равно вернёт 0 — здесь UX-страховка.)
  const belowMin = subtotalCents < LOYALTY_MIN_ORDER_TO_SPEND_CENTS;

  const apply = (raw: string): void => {
    if (belowMin) {
      onChange(0);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const clean = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, balance) : 0;
    onChange(clean);
  };
  return (
    <article className="rounded-lg border bg-card p-4" data-testid="checkout-loyalty-block">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("balance", { points: balance })}</p>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">{t("hint")}</p>
      {belowMin ? (
        <p
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="checkout-loyalty-below-min"
        >
          {t("belowMinHint", {
            min: formatCurrencyUzs(LOYALTY_MIN_ORDER_TO_SPEND_CENTS, locale),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="loyalty-points-input" className="text-sm">
          {t("inputLabel")}
        </label>
        <input
          id="loyalty-points-input"
          type="number"
          min={0}
          max={balance}
          step={1}
          inputMode="numeric"
          value={points === 0 ? "" : points}
          onChange={(e) => apply(e.target.value)}
          placeholder="0"
          disabled={belowMin}
          className="w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
          data-testid="checkout-loyalty-input"
        />
        <button
          type="button"
          onClick={() => onChange(balance)}
          disabled={belowMin}
          className="text-xs text-primary transition-opacity hover:underline disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="checkout-loyalty-max"
        >
          {t("applyMax")}
        </button>
        {points > 0 ? (
          <button
            type="button"
            onClick={() => onChange(0)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="checkout-loyalty-clear"
          >
            {t("clear")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
