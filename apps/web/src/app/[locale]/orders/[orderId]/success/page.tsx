import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { OrderStatusView } from "@/components/orders/order-status-view";

import { loadOrderReturnPage, type OrderReturnPageParams } from "../_lib";

export const metadata: Metadata = {
  // Status-страницы — private state, не индексируем (роботы и так заблокированы
  // через robots.ts, но дублируем для надёжности).
  robots: { index: false, follow: false },
};

interface PageProps {
  params: OrderReturnPageParams;
}

export default async function OrderSuccessPage({ params }: PageProps): Promise<JSX.Element> {
  setRequestLocale(params.locale);
  const { initial } = await loadOrderReturnPage(params);
  return <OrderStatusView orderId={initial.id} variant="success" initial={initial} />;
}
