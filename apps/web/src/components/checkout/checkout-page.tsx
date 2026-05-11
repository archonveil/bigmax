"use client";

import { Link, useRouter } from "@bigmax/i18n/navigation";
import { Check, Loader2, ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { selectItemCount, useCart, useCartHydrated } from "@/cart/store";
import { CHECKOUT_STEPS, stepIndex, useCheckout, useCheckoutHydrated } from "@/checkout/store";
import { OrderSummary } from "@/components/checkout/order-summary";
import { StepAddress } from "@/components/checkout/step-address";
import { StepContacts } from "@/components/checkout/step-contacts";
import { StepDelivery } from "@/components/checkout/step-delivery";
import { StepPayment } from "@/components/checkout/step-payment";
import { StepReview } from "@/components/checkout/step-review";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SavedAddress {
  id: string;
  region: string;
  city: string;
  district: string | null;
  street: string | null;
  house: string | null;
  apartment: string | null;
  landmark: string | null;
  phone: string | null;
  isDefault: boolean;
}

export interface Branch {
  id: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  addressRu: string;
  addressUz: string;
  addressEn: string;
  phone: string | null;
  workingHours: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CheckoutInitial {
  isAuthenticated: boolean;
  contacts: { name: string; email: string; phone: string };
  savedAddresses: SavedAddress[];
  branches: Branch[];
  /** P7-T2: текущий баланс баллов «Бигмах Бонус» (0 для гостей). */
  loyaltyBalance: number;
  /** P7-T2 sub-task M: global kill-switch (feature `loyalty.spend_enabled`).
   *  Если false — UI прячет `<LoyaltyBlock>`, юзер не увидит input. */
  loyaltySpendEnabled: boolean;
}

interface CheckoutPageClientProps {
  initial: CheckoutInitial;
}

export function CheckoutPageClient({ initial }: CheckoutPageClientProps): JSX.Element {
  const t = useTranslations("checkout");
  const router = useRouter();
  const cartHydrated = useCartHydrated();
  const checkoutHydrated = useCheckoutHydrated();
  const itemCount = useCart(selectItemCount);
  const currentStep = useCheckout((s) => s.currentStep);
  const setStep = useCheckout((s) => s.setStep);

  // Guard: корзина пуста → редирект на /cart. Проверяем после rehydrate
  // чтобы не кикать юзера до загрузки persisted items.
  useEffect(() => {
    if (cartHydrated && itemCount === 0) {
      router.replace("/cart");
    }
  }, [cartHydrated, itemCount, router]);

  if (!cartHydrated || !checkoutHydrated) {
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("pageTitle")}</h1>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </section>
    );
  }

  if (itemCount === 0) {
    // Гвард ещё не сработал — покажем минимальный fallback.
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("pageTitle")}</h1>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground" aria-hidden />
          <p className="text-lg font-medium">{t("errors.emptyCart")}</p>
          <p className="text-sm text-muted-foreground">{t("errors.emptyCartHint")}</p>
          <Button asChild>
            <Link href="/catalog">{t("nav.back")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const activeIdx = stepIndex(currentStep);

  return (
    <section className="container grid gap-8 py-10 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-6 text-3xl font-bold">{t("pageTitle")}</h1>

        {/* Stepper indicator */}
        <ol className="mb-8 flex flex-wrap items-center gap-2 sm:gap-4" role="list">
          {CHECKOUT_STEPS.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            const enabled = i <= activeIdx;
            return (
              <li key={s} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (enabled) setStep(s);
                  }}
                  disabled={!enabled}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 text-sm transition",
                    active && "font-semibold text-foreground",
                    done && "text-primary hover:text-primary/80",
                    !enabled && "cursor-not-allowed text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                      active && "border-primary bg-primary text-primary-foreground",
                      done && "border-primary bg-primary/10 text-primary",
                      !active && !done && "border-input text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{t(`steps.${s}`)}</span>
                </button>
                {i < CHECKOUT_STEPS.length - 1 ? (
                  <span aria-hidden className="hidden h-px w-4 bg-border sm:block" />
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* Current step */}
        {currentStep === "contacts" ? (
          <StepContacts
            initialPrefill={initial.contacts}
            isAuthenticated={initial.isAuthenticated}
          />
        ) : currentStep === "address" ? (
          <StepAddress savedAddresses={initial.savedAddresses} />
        ) : currentStep === "delivery" ? (
          <StepDelivery branches={initial.branches} />
        ) : currentStep === "payment" ? (
          <StepPayment />
        ) : (
          <StepReview
            branches={initial.branches}
            isAuthenticated={initial.isAuthenticated}
            loyaltyBalance={initial.loyaltyBalance}
            loyaltySpendEnabled={initial.loyaltySpendEnabled}
          />
        )}
      </div>

      <OrderSummary />
    </section>
  );
}
