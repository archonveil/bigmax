-- P7-T2 sub-task F: `features` table для runtime-feature flags (СПЕЦИФИКАЦИЯ §6 правило 7).
-- Полностью обратимо через DROP TABLE.
--
-- v1: используется только для `loyalty.earn_percent` (динамический процент
-- кэшбэка для маркетинговых акций без перезапуска). Дальше расширяется на
-- другие numeric/boolean/string flags — admin UI в P8-T2 или раньше при
-- необходимости.
--
-- Key — DNS-style (`loyalty.earn_percent`, `promo.cache_ttl_seconds`).
-- Value — строка, parsing в runtime по `type`.
CREATE TYPE "FeatureType" AS ENUM ('number', 'boolean', 'string');

CREATE TABLE "features" (
  "key"        VARCHAR(120) PRIMARY KEY,
  "value"      TEXT NOT NULL,
  "type"       "FeatureType" NOT NULL,
  "description" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed дефолтную loyalty-конфигурацию. Прикладной код всё равно делает
-- fallback на env при отсутствии row, но row даёт ad-hoc admin-override
-- через прямой SQL UPDATE без рестарта.
INSERT INTO "features" ("key", "value", "type", "description") VALUES
  ('loyalty.earn_percent', '1', 'number',
   'P7-T2 «Бигмах Бонус»: процент начисления от Order.totalCents. Hot-reload через 60s Redis-cache. Override env LOYALTY_EARN_PERCENT.');
