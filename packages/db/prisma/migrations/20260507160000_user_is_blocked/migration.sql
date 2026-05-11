-- AlterTable: add is_blocked flag for admin-driven user suspension.
-- Backwards compatible: defaults false, existing users remain unblocked.
ALTER TABLE "users" ADD COLUMN "is_blocked" BOOLEAN NOT NULL DEFAULT false;
