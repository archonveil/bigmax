-- P7-T1: денормализованный snapshot применённого промокода на заказе.
-- Нужен, чтобы при `Payment.status` → `captured` (Uniteller webhook или
-- COD-mark-delivered) бампнуть `Promo.usedCount` для соблюдения `usageLimit`.
-- Не FK на `promos.code` — промо могут удаляться, snapshot должен пережить
-- удаление и оставаться в audit-следе.
ALTER TABLE "orders"
  ADD COLUMN "promo_code" VARCHAR(64);

-- Лёгкий index на случай аналитики "orders by promo".
CREATE INDEX "orders_promo_code_idx" ON "orders"("promo_code");
