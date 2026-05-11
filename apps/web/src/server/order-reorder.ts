/**
 * Re-order: загрузить товары прошлого заказа в формате `CartItemInput`
 * текущей корзины (P5-T2).
 *
 * Не пишем в корзину сами — она хранится в localStorage браузера через
 * Zustand (`@bigmax/web/cart/store`). Endpoint возвращает `addedItems`,
 * клиентский handler делает `useCart.add()` для каждого + редиректит на
 * `/cart`. Так мы не дублируем логику merge'а quantities в backend'е.
 */

import { prisma } from "@bigmax/db";

/**
 * Точно такой же shape, как `CartItemInput` в `cart/store.ts`. Дублируем
 * структуру здесь, чтобы server-fetch не зависел от client-only модуля
 * (Zustand имеет client side-effects на импорте). Тип проверяется compile-time.
 */
export interface ReorderCartItem {
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
  /** Сколько было в исходном заказе. Клиент мерджит с уже-существующим. */
  quantity: number;
}

export interface ReorderResult {
  ok: boolean;
  /** Активные варианты, готовые к добавлению в корзину. */
  addedItems: ReorderCartItem[];
  /** Сколько позиций было пропущено (variant удалён / product.isActive=false). */
  skippedCount: number;
  /** Всего позиций в исходном заказе. */
  totalCount: number;
}

/**
 * Перезагружает варианты прошлого заказа. Owner-проверка ОБЯЗАТЕЛЬНА —
 * иначе любой залогиненный мог бы скопировать чужой заказ в свою корзину.
 * Возвращает `null` если заказ не найден или не принадлежит юзеру.
 */
export async function loadOrderItemsForReorder(
  userId: string,
  orderId: string,
): Promise<ReorderResult | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      items: {
        select: { variantId: true, quantity: true },
      },
    },
  });
  if (!order) return null;

  const totalCount = order.items.length;
  if (totalCount === 0) {
    return { ok: true, addedItems: [], skippedCount: 0, totalCount: 0 };
  }

  // Берём текущие variants — цена/наличие/название могли измениться. Если
  // продукт деактивирован или вариант удалён — пропускаем.
  const variantIds = order.items.map((it) => it.variantId);
  const variants = await prisma.productVariant.findMany({
    where: {
      id: { in: variantIds },
      product: { isActive: true },
    },
    select: {
      id: true,
      productId: true,
      priceCents: true,
      oldPriceCents: true,
      color: true,
      size: true,
      product: {
        select: {
          slug: true,
          nameRu: true,
          nameUz: true,
          nameEn: true,
          brand: { select: { name: true } },
          images: {
            take: 1,
            orderBy: { order: "asc" },
            select: { url: true },
          },
        },
      },
    },
  });

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const addedItems: ReorderCartItem[] = [];
  for (const orderItem of order.items) {
    const v = variantById.get(orderItem.variantId);
    if (!v) continue; // skipped
    addedItems.push({
      variantId: v.id,
      productId: v.productId,
      productSlug: v.product.slug,
      nameRu: v.product.nameRu,
      nameUz: v.product.nameUz,
      nameEn: v.product.nameEn,
      brandName: v.product.brand?.name ?? null,
      imageUrl: v.product.images[0]?.url ?? null,
      color: v.color,
      size: v.size,
      priceCents: v.priceCents,
      oldPriceCents: v.oldPriceCents,
      quantity: orderItem.quantity,
    });
  }

  return {
    ok: true,
    addedItems,
    skippedCount: totalCount - addedItems.length,
    totalCount,
  };
}
