/**
 * P7-T2: серверные fetch-helpers для страницы `/account/loyalty`.
 * Возвращает баланс + paginated историю транзакций (earn/spend) с
 * привязкой к Order.number (опциональной — некоторые транзакции
 * могут быть admin-adjustments в будущем).
 */

import { prisma, LoyaltyType } from "@bigmax/db";

export const LOYALTY_HISTORY_PAGE_SIZE = 20;

export interface AccountLoyaltyTx {
  id: string;
  /** Положительный для earn, отрицательный для spend. */
  points: number;
  type: LoyaltyType;
  /** `Order.number` (`BGX-YYYYMMDD-NNNN`) если транзакция привязана к заказу. */
  orderNumber: string | null;
  orderId: string | null;
  createdAt: Date;
}

export interface AccountLoyaltyResult {
  balance: number;
  items: AccountLoyaltyTx[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function parseLoyaltyHistoryQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): { page: number } {
  const raw = searchParams ?? {};
  const pageRaw = Array.isArray(raw["page"]) ? raw["page"][0] : raw["page"];
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;
  return { page };
}

export async function getAccountLoyalty(
  userId: string,
  page: number,
): Promise<AccountLoyaltyResult> {
  const skip = (page - 1) * LOYALTY_HISTORY_PAGE_SIZE;
  const [user, items, total] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { loyaltyPoints: true },
    }),
    prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: LOYALTY_HISTORY_PAGE_SIZE,
      select: {
        id: true,
        points: true,
        type: true,
        createdAt: true,
        orderId: true,
        order: { select: { number: true } },
      },
    }),
    prisma.loyaltyTransaction.count({ where: { userId } }),
  ]);

  return {
    balance: user?.loyaltyPoints ?? 0,
    items: items.map((tx) => ({
      id: tx.id,
      points: tx.points,
      type: tx.type,
      orderNumber: tx.order?.number ?? null,
      orderId: tx.orderId,
      createdAt: tx.createdAt,
    })),
    total,
    page,
    pageSize: LOYALTY_HISTORY_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / LOYALTY_HISTORY_PAGE_SIZE)),
  };
}
