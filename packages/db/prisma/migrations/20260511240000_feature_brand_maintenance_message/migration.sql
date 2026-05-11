-- P7-T2 sub-task O: seed string feature row для `brand.maintenance_message`.
-- Это первый real-world consumer `getStringFeature` — глобальный banner
-- на всех страницах сайта, который admin включает текстом ("Сайт работает
-- в режиме ограниченного функционала до 23:00") или выключает clearing.
--
-- Default: пустая строка → banner скрыт. Admin меняет через
-- /admin/features/brand.maintenance_message.
INSERT INTO "features" ("key", "value", "type", "description") VALUES
  ('brand.maintenance_message', '', 'string',
   'P7-T2: текст maintenance-banner''а. Пусто → banner скрыт. Любая non-empty строка → banner показан на всех страницах сайта. Hot-reload через 60s Redis-cache.');
