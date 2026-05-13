-- Make OrderItem.variantId nullable so products/variants with order history
-- can be hard-deleted. productSnapshot preserves all display data; variantId
-- becomes NULL on deletion via the new SetNull FK rule.

-- Drop the old non-nullable FK constraint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_variant_id_fkey";

-- Allow NULL
ALTER TABLE "order_items" ALTER COLUMN "variant_id" DROP NOT NULL;

-- Re-add FK with SET NULL on delete
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
