-- P7-T2 sub-task L: seed boolean feature row для `loyalty.spend_enabled`.
-- Это первый real-world consumer `getBooleanFeature` — kill-switch на
-- списание баллов при checkout. Полезно для emergency-disable (fraud
-- incident, баг в clamp-логике) — admin переключает radio в UI и за ≤ 60s
-- spend-операции прекращаются без deploy'а.
--
-- Default: 'true' — программа лояльности работает по умолчанию.
INSERT INTO "features" ("key", "value", "type", "description") VALUES
  ('loyalty.spend_enabled', 'true', 'boolean',
   'P7-T2 «Бигмах Бонус»: глобальный kill-switch на списание баллов в checkout/pay. ''false'' → loyaltyPointsSpent игнорируется (но earn-flow продолжает работать). Hot-reload через 60s Redis-cache.');
