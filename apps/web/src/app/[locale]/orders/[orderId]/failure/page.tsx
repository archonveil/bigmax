import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { OrderStatusView } from "@/components/orders/order-status-view";

import { loadOrderReturnPage, type OrderReturnPageParams } from "../_lib";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: OrderReturnPageParams;
}

export default async function OrderFailurePage({ params }: PageProps): Promise<JSX.Element> {
  setRequestLocale(params.locale);
  const { initial } = await loadOrderReturnPage(params);
  return <OrderStatusView orderId={initial.id} variant="failure" initial={initial} />;
}
