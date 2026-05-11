"use client";

import { estimateDelivery, type DeliveryEstimate } from "@bigmax/shared-types";
import { useMemo } from "react";

import { selectSubtotalCents, useCart } from "@/cart/store";
import { useCheckout } from "@/checkout/store";

/**
 * Реактивный предпросмотр доставки — один источник истины (`estimateDelivery`
 * из @bigmax/shared-types), который затем будет перевычислен на сервере в P4-T5.
 *
 * Читает из checkout-store (method/region/district) и cart-store (subtotal для
 * free-shipping threshold). Мемоизируется по релевантным полям.
 */
export function useDeliveryEstimate(): DeliveryEstimate {
  const method = useCheckout((s) => s.delivery.method);
  const region = useCheckout((s) => s.address.region);
  const district = useCheckout((s) => s.address.district);
  const subtotalCents = useCart(selectSubtotalCents);

  return useMemo(
    () =>
      estimateDelivery({
        method: method ?? "courier",
        region: region ?? "",
        district: district ?? "",
        subtotalCents,
      }),
    [method, region, district, subtotalCents],
  );
}
