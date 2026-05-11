/**
 * Общая SSR-логика для return-страниц Uniteller (P4-T7).
 *
 * Делает auth-redirect, owner-проверку, загружает initial snapshot для
 * первого рендера до того как client-island начнёт polling. Owner-mismatch
 * → notFound (не отдаём 403, чтобы не раскрывать существование чужих ID).
 */

import { prisma } from "@bigmax/db";
import { isLocale, type Locale, type OrderStatusResponse } from "@bigmax/shared-types";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";

export interface OrderReturnPageParams {
  locale: string;
  orderId: string;
}

export interface OrderReturnPageData {
  locale: Locale;
  initial: OrderStatusResponse;
}

export async function loadOrderReturnPage(
  params: OrderReturnPageParams,
): Promise<OrderReturnPageData> {
  if (!isLocale(params.locale)) notFound();

  const session = await auth();
  if (!session?.user.id) {
    redirect(
      `/${params.locale}/auth/login?returnTo=${encodeURIComponent(`/${params.locale}/orders`)}`,
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: {
      id: true,
      number: true,
      status: true,
      userId: true,
      totalCents: true,
      currency: true,
      locale: true,
      payments: {
        select: { status: true, provider: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!order || order.userId !== session.user.id) notFound();
  const payment = order.payments[0];
  if (!payment) notFound();

  const initial: OrderStatusResponse = {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: payment.status,
    paymentProvider: payment.provider,
    totalCents: order.totalCents,
    currency: order.currency,
    locale: order.locale,
  };

  return { locale: params.locale, initial };
}
