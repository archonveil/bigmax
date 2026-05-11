-- Phase 1: composite + trigram indexes (OPTIMIZATION_PLAN.md §1).
--
-- Reasoning:
--   * orders(status, created_at) — admin-dashboard `aggregateRevenue` filters
--     status IN (...) AND created_at >= since. Without composite, planner
--     picks one single-column index, filters the rest in memory.
--   * order_items(variant_id, order_id) — top-products groupBy by variant_id
--     also filters by order_id IN (...).
--   * payments(order_id, created_at DESC) — admin-orders list does
--     `payments: { take: 1, orderBy: { createdAt: desc } }` per row.
--   * pg_trgm + GIN indexes for ILIKE on products names + users.email —
--     today these run SeqScan; index makes catalog/search subsecond at >1k SKUs.
--
-- All ALTER ops are CONCURRENTLY-incompatible inside one tx, so use plain
-- CREATE INDEX (Prisma migrate already wraps in tx). The dev DB is small;
-- prod migration team should re-issue with CONCURRENTLY in a follow-up.
-- pg_trgm extension is idempotent (CREATE EXTENSION IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");
CREATE INDEX "order_items_variant_id_order_id_idx" ON "order_items"("variant_id", "order_id");
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at" DESC);

-- Catalog ILIKE: search by product name across 3 locales.
-- COALESCE so NULL columns don't break the trigram index expression.
CREATE INDEX "products_name_trgm_idx" ON "products"
  USING gin (
    (COALESCE("name_ru", '') || ' ' || COALESCE("name_uz", '') || ' ' || COALESCE("name_en", ''))
    gin_trgm_ops
  );

-- Admin orders search by user email — also ILIKE, also SeqScan today.
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin ("email" gin_trgm_ops);
