"use client";

import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { useLocale, useTranslations } from "next-intl";

import { computeDiscountCents } from "@/cart/promo";
import { selectItems, selectSubtotalCents, selectTotalItems, useCart } from "@/cart/store";
import { useCheckout } from "@/checkout/store";
import { useDeliveryEstimate } from "@/checkout/use-delivery-estimate";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";

export function OrderSummary(): JSX.Element {
  const tCart = useTranslations("cart");
  const tPage = useTranslations("cart.page");
  const tDelivery = useTranslations("checkout.delivery.cost");
  const tLoyalty = useTranslations("checkout.loyalty");
  const locale = useLocale() as Locale;
  const items = useCart(selectItems);
  const totalItems = useCart(selectTotalItems);
  const subtotalCents = useCart(selectSubtotalCents);
  const appliedPromo = useCart((s) => s.appliedPromo);
  const loyaltyPointsToSpend = useCheckout((s) => s.loyaltyPointsToSpend);
  const estimate = useDeliveryEstimate();

  const discountCents = appliedPromo ? computeDiscountCents(appliedPromo, subtotalCents) : 0;
  const deliveryCents = estimate.kind === "priced" ? estimate.cents : 0;
  // P7-T2: client-side discount preview. Сервер сделает финальный clamp при
  // checkout/pay — здесь только визуал, не security-критично.
  const loyaltyDiscountCents = Math.max(0, loyaltyPointsToSpend) * 100;
  const totalCents = Math.max(
    0,
    subtotalCents - discountCents + deliveryCents - loyaltyDiscountCents,
  );

  // Row для доставки: три состояния — "priced>0", "priced=0 (free/pickup)",
  // "needs-info". Отдельная ветка для unknown-region — сохраняем старый fallback.
  const deliveryValue =
    estimate.kind === "priced"
      ? estimate.cents === 0
        ? tDelivery("free")
        : formatCurrencyUzs(estimate.cents, locale)
      : estimate.reason === "missing-region"
        ? tDelivery("needsRegion")
        : estimate.reason === "missing-district"
          ? tDelivery("needsDistrict")
          : tPage("deliveryCalculated");

  const deliveryValueClass =
    estimate.kind === "priced" && estimate.isFree ? "text-primary" : "text-muted-foreground";

  return (
    <aside className="h-fit space-y-4 rounded-lg border bg-card p-5 lg:sticky lg:top-24">
      <header className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{tPage("title")}</h2>
        <span className="text-sm text-muted-foreground">
          {tCart("itemsCount", { count: totalItems })}
        </span>
      </header>

      <ul className="space-y-2 border-y py-3">
        {items.map((it) => (
          <li key={it.variantId} className="flex items-center gap-3 text-sm">
            <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
              <ProductImage src={it.imageUrl} alt="" fill sizes="40px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1 truncate">{localized(it, "name", locale)}</span>
            <span className="flex-shrink-0 text-muted-foreground">× {it.quantity}</span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1 text-sm">
        <Row label={tPage("subtotal")} value={formatCurrencyUzs(subtotalCents, locale)} />
        {discountCents > 0 ? (
          <Row
            label={tPage("discount")}
            value={formatCurrencyUzs(-discountCents, locale)}
            valueClassName="text-primary"
          />
        ) : null}
        <Row label={tPage("delivery")} value={deliveryValue} valueClassName={deliveryValueClass} />
        {loyaltyDiscountCents > 0 ? (
          <Row
            label={tLoyalty("appliedRow", { points: loyaltyPointsToSpend })}
            value={formatCurrencyUzs(-loyaltyDiscountCents, locale)}
            valueClassName="text-primary"
          />
        ) : null}
      </dl>

      <dl className="flex items-baseline justify-between border-t pt-3 text-base font-semibold">
        <dt>{tPage("total")}</dt>
        <dd>{formatCurrencyUzs(totalCents, locale)}</dd>
      </dl>
    </aside>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", valueClassName)}>{value}</dd>
    </div>
  );
}
