-- AlterTable: add Telegram Login Widget fields to users.
-- All nullable & backwards-compatible: existing rows remain untouched.
-- `telegram_id` is unique-indexed (one Telegram account = one User).
ALTER TABLE "users"
  ADD COLUMN "telegram_id"         TEXT,
  ADD COLUMN "telegram_username"   TEXT,
  ADD COLUMN "telegram_first_name" TEXT,
  ADD COLUMN "telegram_last_name"  TEXT,
  ADD COLUMN "telegram_photo_url"  TEXT,
  ADD COLUMN "telegram_auth_date"  TIMESTAMP(3);

CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");
