-- P7-T2 sub-task A: расширяем `LoyaltyType` enum новыми значениями для
-- reverse-сценариев при cancel/refund заказа.
--   - `refund`   — возврат списанных баллов на User.loyaltyPoints (mirror of `spend`).
--   - `clawback` — изъятие ранее начисленных баллов (mirror of `earn`).
-- Раньше reversal-row пришлось бы писать как обычный `earn`/`spend` —
-- неотличимо от регулярных операций в истории. Новые типы дают чистый
-- audit-trail и упрощают UI /account/loyalty.
ALTER TYPE "LoyaltyType" ADD VALUE IF NOT EXISTS 'refund';
ALTER TYPE "LoyaltyType" ADD VALUE IF NOT EXISTS 'clawback';
