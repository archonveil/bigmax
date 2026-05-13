/**
 * Server-side fetch для `/account/orders/[id]` (P5-T2). Detail-страница
 * рендерит позиции, адрес/филиал, payment, refunds. Owner-проверка делается
 * по `userId` — на чужой order возвращается `null`, page → `notFound()`.
 *
 * Re-order и refund-request endpoints используют `getOrderDetail` для
 * валидации того, что юзер действительно владеет заказом, прежде чем
 * выполнять мутацию.
 */

import { prisma, type OrderStatus } from "@bigmax/db";

export interface OrderItemDetail {
  id: string;
  variantId: string | null;
  quantity: number;
  priceCents: number;
  /**
   * Снапшот товара на момент заказа — используется для рендера UI без
   * похода в текущие Variant/Product (вариант мог быть удалён).
   * Поля произвольные — что мы клали в P4-T5.
   */
  snapshot: {
    sku?: string;
    color?: string | null;
    size?: string | null;
    product?: {
      slug?: string;
      nameRu?: string;
      nameUz?: string;
      nameEn?: string;
    };
  };
}

export interface OrderDetailPayment {
  id: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  unitellerCardMask: string | null;
  unitellerBillnumber: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

export interface OrderDetailRefund {
  id: string;
  paymentId: string;
  amountCents: number;
  reason: string;
  status: string;
  createdAt: Date;
}

export interface OrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  subtotalCents: number;
  deliveryCostCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  deliveryMethod: "courier" | "pickup";
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemDetail[];
  payments: OrderDetailPayment[];
  refunds: OrderDetailRefund[];
  address: {
    region: string;
    city: string;
    district: string | null;
    street: string | null;
    house: string | null;
    apartment: string | null;
    landmark: string | null;
    phone: string | null;
  } | null;
  branch: {
    id: string;
    nameRu: string;
    nameUz: string;
    nameEn: string;
    addressRu: string;
    addressUz: string;
    addressEn: string;
    phone: string | null;
  } | null;
}

/**
 * Загружает все необходимые для UI поля. Возвращает `null` если заказ не
 * найден ИЛИ принадлежит другому юзеру — наружу не проливаем «не ваш заказ»
 * (§5 — auth-API возвращает 404, не 403).
 */
export async function getOrderDetail(userId: string, orderId: string): Promise<OrderDetail | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      number: true,
      status: true,
      subtotalCents: true,
      deliveryCostCents: true,
      discountCents: true,
      totalCents: true,
      currency: true,
      deliveryMethod: true,
      comment: true,
      createdAt: true,
      updatedAt: true,
      address: {
        select: {
          region: true,
          city: true,
          district: true,
          street: true,
          house: true,
          apartment: true,
          landmark: true,
          phone: true,
        },
      },
      branch: {
        select: {
          id: true,
          nameRu: true,
          nameUz: true,
          nameEn: true,
          addressRu: true,
          addressUz: true,
          addressEn: true,
          phone: true,
        },
      },
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          priceCents: true,
          productSnapshot: true,
        },
        orderBy: { id: "asc" },
      },
      payments: {
        select: {
          id: true,
          provider: true,
          status: true,
          amountCents: true,
          currency: true,
          unitellerCardMask: true,
          unitellerBillnumber: true,
          capturedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) return null;

  // Refund'ы фетчим отдельным запросом, потому что Prisma include через
  // payments → refunds дублирует строки.
  const paymentIds = order.payments.map((p) => p.id);
  // Тип амэунтов — `number` благодаря $extends.result в @bigmax/db,
  // поэтому не используем `Prisma.RefundGetPayload<...>` (который вернул бы
  // bigint от raw-схемы) — пусть TS инферит из самого вызова.
  const refunds =
    paymentIds.length > 0
      ? await prisma.refund.findMany({
          where: { paymentId: { in: paymentIds } },
          select: {
            id: true,
            paymentId: true,
            amountCents: true,
            reason: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  return {
    ...order,
    deliveryMethod: order.deliveryMethod as "courier" | "pickup",
    items: order.items.map((it) => ({
      id: it.id,
      variantId: it.variantId,
      quantity: it.quantity,
      priceCents: it.priceCents,
      snapshot: (it.productSnapshot ?? {}) as OrderItemDetail["snapshot"],
    })),
    refunds,
  };
}
