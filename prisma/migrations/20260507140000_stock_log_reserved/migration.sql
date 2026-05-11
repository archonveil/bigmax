-- AlterTable: add reserved-tracking columns to stock_logs.
-- Backwards compatible: defaults 0 for existing rows.
ALTER TABLE "stock_logs"
  ADD COLUMN "old_reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "new_reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reserved_delta" INTEGER NOT NULL DEFAULT 0;
