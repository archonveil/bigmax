-- Migrate all monetary columns INT4 → BIGINT.
-- Reason: INT4 max = 2,147,483,647 tiyin = ~21.5M soum (~$1,690 USD). For an
-- electronics shop in Uzbekistan that's a real production-blocking ceiling
-- (laptops/fridges/ovens easily push a multi-item cart past it). BIGINT
-- gives 9.2e18 — effectively unbounded for retail.
--
-- Postgres `ALTER COLUMN ... TYPE BIGINT` rewrites the table (it's a
-- type-widening conversion, lossless). On large prod tables this can be
-- slow + holds an exclusive lock; on this dataset it's instant.
--
-- App side: BigInt → number coercion happens in the @bigmax/db Prisma
-- client extension ($extends.result), so all consumer code stays on `number`.
-- Only Prisma WRITE sites need explicit `BigInt(value)`.

ALTER TABLE "product_variants"
  ALTER COLUMN "price_cents"     TYPE BIGINT,
  ALTER COLUMN "old_price_cents" TYPE BIGINT;

ALTER TABLE "orders"
  ALTER COLUMN "subtotal_cents"      TYPE BIGINT,
  ALTER COLUMN "delivery_cost_cents" TYPE BIGINT,
  ALTER COLUMN "discount_cents"      TYPE BIGINT,
  ALTER COLUMN "total_cents"         TYPE BIGINT;

ALTER TABLE "order_items"
  ALTER COLUMN "price_cents" TYPE BIGINT;

ALTER TABLE "payments"
  ALTER COLUMN "amount_cents" TYPE BIGINT;

ALTER TABLE "refunds"
  ALTER COLUMN "amount_cents" TYPE BIGINT;

ALTER TABLE "promos"
  ALTER COLUMN "min_order_cents" TYPE BIGINT;
