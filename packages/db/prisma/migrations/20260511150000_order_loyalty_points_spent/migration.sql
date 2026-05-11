-- P7-T2: snapshot потраченных баллов лояльности на заказе.
-- Нужен, чтобы (а) UI заказа показывал «вы потратили N баллов»,
-- (б) при reverse-сценариях (cancel/refund) можно было корректно вернуть
-- баллы на User.loyaltyPoints (open question — будет в follow-up).
-- INT с default 0 — обратно совместимо со старыми заказами.
ALTER TABLE "orders"
  ADD COLUMN "loyalty_points_spent" INTEGER NOT NULL DEFAULT 0;
