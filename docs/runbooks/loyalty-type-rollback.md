# Runbook · откат миграции `20260511180000_loyalty_type_refund_clawback`

> Связано: СПЕЦИФИКАЦИЯ §8 / **P8-T6** (runbook по инцидентам Uniteller +
> расширение на loyalty/promo). P7-T2 sub-task E.

## Контекст

Миграция [`20260511180000_loyalty_type_refund_clawback`](../../packages/db/prisma/migrations/20260511180000_loyalty_type_refund_clawback/migration.sql)
добавила в Postgres-enum `LoyaltyType` два новых значения:
`refund` (mirror of `spend`) и `clawback` (mirror of `earn`). Используются
helper'ом `reverseLoyaltyForOrder(tx, orderId)` при cancel/refund заказа.

**Postgres ограничение**: `ALTER TYPE ... ADD VALUE` нельзя откатить через
обратное `DROP VALUE` — такой команды просто нет. Единственный путь —
пересоздание типа с прежним набором значений + миграция данных в FK-ссылках.

Поэтому Prisma не генерирует down-миграцию для этого ADD VALUE — это
ожидаемо, а не баг. Этот runbook описывает, **что делать, если rollback
действительно понадобится** (например, hotfix-revert prod-релиза).

---

## Когда нужен откат

Сценарий: только если `refund` / `clawback` оказались семантически неверными
и команда решила переименовать или удалить. Обычные баги в логике
`reverseLoyaltyForOrder` чинятся через прямой forward-fix, без отката enum'а.

## Решение 1 — Forward-rollback (РЕКОМЕНДУЕМЫЙ)

Не трогаем enum, но переводим существующие `refund` / `clawback` rows
обратно в `earn` / `spend` через UPDATE:

```sql
BEGIN;

-- 1. Свернуть refund'ы обратно в earn (положительные points).
UPDATE loyalty_transactions
   SET type = 'earn'
 WHERE type = 'refund';

-- 2. Свернуть clawback'и обратно в spend (отрицательные points).
UPDATE loyalty_transactions
   SET type = 'spend'
 WHERE type = 'clawback';

COMMIT;
```

После этого можно деплоить кодовую базу до P7-T2-followup (без вызовов
`reverseLoyaltyForOrder`). Enum-значения `refund` / `clawback` останутся в
типе, но ни одна row на них не будет ссылаться — это OK, никакой
performance-penalty.

История потеряет различение reversal vs регулярных операций, но
сумма-баланса (`SUM(points)`) остаётся корректной → реальное состояние
`User.loyaltyPoints` не разойдётся.

## Решение 2 — Полное пересоздание enum'а (НЕ РЕКОМЕНДУЕТСЯ)

Только если по неведомой причине нужно физически удалить значения из
типа. Требует downtime (lock на таблицу `loyalty_transactions`).

```sql
BEGIN;

-- 1. Свернуть данные (как в Решении 1).
UPDATE loyalty_transactions SET type = 'earn'  WHERE type = 'refund';
UPDATE loyalty_transactions SET type = 'spend' WHERE type = 'clawback';

-- 2. Создать временный enum с прежним набором значений.
CREATE TYPE "LoyaltyType_old" AS ENUM ('earn', 'spend');

-- 3. Переключить колонку на новый тип через USING-cast.
ALTER TABLE loyalty_transactions
  ALTER COLUMN type TYPE "LoyaltyType_old"
  USING (type::text::"LoyaltyType_old");

-- 4. Удалить старый enum, переименовать.
DROP TYPE "LoyaltyType";
ALTER TYPE "LoyaltyType_old" RENAME TO "LoyaltyType";

COMMIT;
```

**Внимание**: после этого Prisma client тоже нужно регенерировать
(`prisma generate` с откатанной schema.prisma). Если код продолжит писать
`refund` / `clawback` — упадёт на runtime.

## Чеклист перед откатом

- [ ] Создан Sentry-инцидент с описанием root cause.
- [ ] Подтверждён downtime-окно с stakeholder'ом.
- [ ] Бэкап БД свежий (`pg_dump --schema=public bigmax > backup-YYYY-MM-DD.sql`).
- [ ] Кодовая база подготовлена — все `reverseLoyaltyForOrder`-call-site'ы
      убраны или возвращают raw `earn` / `spend`.
- [ ] Решение выбрано: forward-rollback (предпочтительно) или полное
      пересоздание (только при критической необходимости).
- [ ] После применения — smoke-test: создать тестовый cancel'd-order +
      verify баланс пользователя корректен.

## Связанные документы

- Миграция: [`packages/db/prisma/migrations/20260511180000_loyalty_type_refund_clawback/migration.sql`](../../packages/db/prisma/migrations/20260511180000_loyalty_type_refund_clawback/migration.sql)
- Helper: [`apps/web/src/server/loyalty.ts`](../../apps/web/src/server/loyalty.ts) (`reverseLoyaltyForOrder`)
- Test: [`apps/web/src/server/loyalty.test.ts`](../../apps/web/src/server/loyalty.test.ts) (describe `reverseLoyaltyForOrder`)
- README P7-T2 sub-task A: [`../../README.md`](../../README.md)
