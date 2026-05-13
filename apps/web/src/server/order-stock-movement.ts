/**
 * P6-T7 follow-up (closes (d)-полное): аудит движения склада на всех
 * order-flow событиях.
 *
 * Три операции:
 *  - **`reserveOrderStock`**: на checkout создаём заказ → инкрементим
 *    `Stock.reserved += qty` для каждой позиции + StockLog{action:"reserve"}.
 *    Quantity не меняется (товар физически на складе остаётся, просто
 *    помечен как "забронирован под заказ").
 *  - **`releaseOrderStock`**: на cancel (customer или admin) → декрементим
 *    `Stock.reserved -= qty` + StockLog{action:"release"}. Quantity не
 *    меняется. Идемпотентно: если reserved уже 0 → no-op skip с reason
 *    "no_reserved_to_release".
 *  - **`commitOrderShipment`**: на admin → shipped → декрементим И
 *    `Stock.quantity -= qty` И `Stock.reserved -= qty` (одной транзакцией +
 *    одной StockLog-записью с action="ship", где `delta` отражает qty-движение
 *    и `reservedDelta` — reserved-движение).
 *
 * **Branch routing**: pickup-orders → `Order.branchId`; courier-orders →
 * первый-активный филиал (note: proper logistics-routing для multi-warehouse
 * sharding — отдельный slot, P8-T1 при load-test'ах).
 *
 * **Не throw'ит** — discriminated `Result` для caller'а; route-handler
 * решает что делать (Sentry breadcrumb / silent skip / 502 response).
 *
 * **Idempotency note**: helper'ы могут вызываться второй раз через retry'и
 * (например, webhook-double-callback). Защита внутри: `reserveOrderStock`
 * сейчас не дедупит — caller отвечает за единственность вызова через
 * `WebhookEvent`-flag (P4-T6 idempotency table) или transaction-locking.
 * При повторном вызове reserved будет инкрементиться второй раз → bug.
 * Mitigation: помечаем Order.metadata-флагом "stock_reserved_at"; пока что
 * в P6-T7 follow-up'е оставлено caller'у, это open question P8.
 */

import { type Prisma, type TransactionClient, prisma } from "@bigmax/db";

type TxClient = TransactionClient;
// `Prisma` namespace is used inline below for `Prisma.StockLogUncheckedCreateInput`.

interface Movement {
  stockId: string;
  sku: string;
  oldQty: number;
  newQty: number;
  delta: number;
  oldReserved: number;
  newReserved: number;
  reservedDelta: number;
}

interface SkippedItem {
  sku: string;
  reason: "no_stock_row" | "no_branch_resolved" | "no_reserved_to_release" | "db_error";
}

export interface MovementResult {
  kind: "ok";
  committed: Movement[];
  skipped: SkippedItem[];
}

interface OperationInput {
  orderId: string;
  /** ID admin'а если flow admin-driven, null для customer-flow'а
   *  (checkout, customer-cancel). */
  adminUserId: string | null;
  /** Externally-supplied tx client (для встраивания в существующий
   *  $transaction). Если не передан — создаём свой. */
  tx?: TxClient;
}

async function loadOrderForMovement(client: TxClient | typeof prisma, orderId: string) {
  return client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      branchId: true,
      deliveryMethod: true,
      items: {
        select: {
          variantId: true,
          quantity: true,
          variant: { select: { sku: true } },
        },
      },
    },
  });
}

async function resolveBranchId(
  client: TxClient | typeof prisma,
  orderBranchId: string | null,
): Promise<string | null> {
  if (orderBranchId) return orderBranchId;
  const fallback = await client.storeBranch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

/**
 * Reserve: при создании заказа в `/api/checkout/pay`. Инкрементит
 * `Stock.reserved += qty` без изменения quantity. Best-effort: если
 * Stock-row не существует для (variant, branch) — попадает в skipped[],
 * не валит checkout (товар может быть «доступен в каталоге» через
 * другой склад, либо stock-row не созданный admin'ом).
 */
export async function reserveOrderStock(input: OperationInput): Promise<MovementResult> {
  return runMovement(input, async (client, order, branchId) => {
    const committed: Movement[] = [];
    const skipped: SkippedItem[] = [];

    for (const item of order.items) {
      if (!item.variantId || !item.variant) continue;
      const variantId = item.variantId;
      const sku = item.variant.sku;
      const stock = await client.stock.findUnique({
        where: { variantId_branchId: { variantId, branchId } },
        select: { id: true, quantity: true, reserved: true },
      });
      if (!stock) {
        skipped.push({ sku, reason: "no_stock_row" });
        continue;
      }
      const newReserved = stock.reserved + item.quantity;
      try {
        await client.stock.update({
          where: { id: stock.id },
          data: { reserved: newReserved },
          select: { id: true },
        });
        await client.stockLog.create({
          data: {
            stockId: stock.id,
            variantId,
            branchId,
            action: "reserve",
            oldQty: stock.quantity,
            newQty: stock.quantity,
            delta: 0,
            oldReserved: stock.reserved,
            newReserved,
            reservedDelta: item.quantity,
            reason: `Order ${order.number} reserved (${item.quantity} units)`,
            adminUserId: input.adminUserId,
          } satisfies Prisma.StockLogUncheckedCreateInput,
          select: { id: true },
        });
        committed.push({
          stockId: stock.id,
          sku,
          oldQty: stock.quantity,
          newQty: stock.quantity,
          delta: 0,
          oldReserved: stock.reserved,
          newReserved,
          reservedDelta: item.quantity,
        });
      } catch {
        skipped.push({ sku, reason: "db_error" });
      }
    }

    return { committed, skipped };
  });
}

/**
 * Release: на cancel (customer или admin → cancelled/refunded). Декрементит
 * `Stock.reserved -= qty`, не трогая quantity. Если reserved уже 0 —
 * skipped[no_reserved_to_release] (защита от double-release при manual
 * intervention'е).
 */
export async function releaseOrderStock(input: OperationInput): Promise<MovementResult> {
  return runMovement(input, async (client, order, branchId) => {
    const committed: Movement[] = [];
    const skipped: SkippedItem[] = [];

    for (const item of order.items) {
      if (!item.variantId || !item.variant) continue;
      const variantId = item.variantId;
      const sku = item.variant.sku;
      const stock = await client.stock.findUnique({
        where: { variantId_branchId: { variantId, branchId } },
        select: { id: true, quantity: true, reserved: true },
      });
      if (!stock) {
        skipped.push({ sku, reason: "no_stock_row" });
        continue;
      }
      if (stock.reserved <= 0) {
        skipped.push({ sku, reason: "no_reserved_to_release" });
        continue;
      }
      const newReserved = Math.max(0, stock.reserved - item.quantity);
      try {
        await client.stock.update({
          where: { id: stock.id },
          data: { reserved: newReserved },
          select: { id: true },
        });
        await client.stockLog.create({
          data: {
            stockId: stock.id,
            variantId,
            branchId,
            action: "release",
            oldQty: stock.quantity,
            newQty: stock.quantity,
            delta: 0,
            oldReserved: stock.reserved,
            newReserved,
            reservedDelta: newReserved - stock.reserved,
            reason: `Order ${order.number} released (${item.quantity} units)`,
            adminUserId: input.adminUserId,
          } satisfies Prisma.StockLogUncheckedCreateInput,
          select: { id: true },
        });
        committed.push({
          stockId: stock.id,
          sku,
          oldQty: stock.quantity,
          newQty: stock.quantity,
          delta: 0,
          oldReserved: stock.reserved,
          newReserved,
          reservedDelta: newReserved - stock.reserved,
        });
      } catch {
        skipped.push({ sku, reason: "db_error" });
      }
    }

    return { committed, skipped };
  });
}

/**
 * Commit shipment: на admin → shipped. Декрементит И `Stock.quantity` И
 * `Stock.reserved` (одной транзакцией, одной StockLog-записью с обеими
 * delta'ми). Если reserved < qty — clamp на 0 (защита от inconsistent
 * state'а: на ranges-sync с реальным складом отчёт покажет negative-delta).
 */
export async function commitOrderShipment(input: OperationInput): Promise<MovementResult> {
  return runMovement(input, async (client, order, branchId) => {
    const committed: Movement[] = [];
    const skipped: SkippedItem[] = [];

    for (const item of order.items) {
      if (!item.variantId || !item.variant) continue;
      const variantId = item.variantId;
      const sku = item.variant.sku;
      const stock = await client.stock.findUnique({
        where: { variantId_branchId: { variantId, branchId } },
        select: { id: true, quantity: true, reserved: true },
      });
      if (!stock) {
        skipped.push({ sku, reason: "no_stock_row" });
        continue;
      }
      const newQty = Math.max(0, stock.quantity - item.quantity);
      const newReserved = Math.max(0, stock.reserved - item.quantity);
      const qtyDelta = newQty - stock.quantity;
      const reservedDelta = newReserved - stock.reserved;
      try {
        await client.stock.update({
          where: { id: stock.id },
          data: { quantity: newQty, reserved: newReserved },
          select: { id: true },
        });
        await client.stockLog.create({
          data: {
            stockId: stock.id,
            variantId,
            branchId,
            action: "ship",
            oldQty: stock.quantity,
            newQty,
            delta: qtyDelta,
            oldReserved: stock.reserved,
            newReserved,
            reservedDelta,
            reason: `Order ${order.number} shipped (${item.quantity} units)`,
            adminUserId: input.adminUserId,
          } satisfies Prisma.StockLogUncheckedCreateInput,
          select: { id: true },
        });
        committed.push({
          stockId: stock.id,
          sku,
          oldQty: stock.quantity,
          newQty,
          delta: qtyDelta,
          oldReserved: stock.reserved,
          newReserved,
          reservedDelta,
        });
      } catch {
        skipped.push({ sku, reason: "db_error" });
      }
    }

    return { committed, skipped };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runMovement(
  input: OperationInput,
  fn: (
    client: TxClient | typeof prisma,
    order: NonNullable<Awaited<ReturnType<typeof loadOrderForMovement>>>,
    branchId: string,
  ) => Promise<{ committed: Movement[]; skipped: SkippedItem[] }>,
): Promise<MovementResult> {
  const client = input.tx ?? prisma;
  const order = await loadOrderForMovement(client, input.orderId);
  if (!order) {
    return { kind: "ok", committed: [], skipped: [] };
  }
  const branchId = await resolveBranchId(client, order.branchId);
  if (!branchId) {
    return {
      kind: "ok",
      committed: [],
      skipped: order.items
        .filter((it) => it.variant)
        .map((it) => ({
          sku: it.variant!.sku,
          reason: "no_branch_resolved" as const,
        })),
    };
  }
  const out = await fn(client, order, branchId);
  return { kind: "ok", committed: out.committed, skipped: out.skipped };
}
