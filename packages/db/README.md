# @bigmax/db

Prisma schema, миграции, seed-скрипт и типизированный клиент для Бигмах.

## Соглашения

- **ID:** `cuid()` строки (короче UUID, сортируемы, читаемы).
- **Деньги:** `*_cents` — integer, тийны (UZS × 100). Конвертация в decimal только при передаче в Uniteller (`Subtotal_P`).
- **Время:** `createdAt @default(now())` + `updatedAt @updatedAt` (Prisma).
- **Мультиязычность:** денормализованные колонки `*_ru`, `*_uz`, `*_en` в таблицах с UI-контентом (Category, Product, StoreBranch). Fallback логика — в `@bigmax/shared-types` (P0-T4).
- **Именование таблиц:** snake_case в БД через `@@map("...")`; модели в Prisma — PascalCase, поля — camelCase с `@map("...")`.
- **onDelete:** `Cascade` для true child-записей (CartItem → Cart), `SetNull` для ссылок, которые должны переживать родителя (Product.brand → Brand).

## Команды

Запускать из `packages/db/` или через `pnpm --filter @bigmax/db`:

```bash
pnpm db:generate   # сгенерировать TypeScript-клиент из schema.prisma
pnpm db:migrate    # создать и применить миграцию (dev)
pnpm db:deploy     # применить миграции в prod (без генерации новых)
pnpm db:reset      # обнулить БД и прогнать все миграции + seed
pnpm db:seed       # только seed
pnpm db:studio     # визуальный Prisma Studio
```

## Структура

```
packages/db/
  prisma/
    schema.prisma     — 22 модели, 11 enum'ов
    seed.ts           — минимальный dev-датасет
    migrations/       — сгенерированные миграции (init + follow-ups)
  src/
    index.ts          — singleton PrismaClient + re-export типов
```

## Ключевые модели

- **User** — customer / admin / manager; `language` для локализации уведомлений.
- **Product / ProductVariant / ProductImage** — варианты (цвет/размер/SKU) + галерея.
- **Cart / CartItem** — привязана к userId (для залогиненных) или sessionId (гость).
- **Order / OrderItem** — снапшот товара в JSON на момент покупки. `number` формата `BGX-YYYYMMDD-NNNN` используется как `Order_IDP` в Uniteller.
- **Payment** — `provider: uniteller | cod`. Хранит `uniteller_order_idp`, `billnumber`, `response_code`, `card_mask`.
- **Refund** — частичные/полные возвраты, инициируются админом.
- **WebhookEvent** — идемпотентность callback'ов Uniteller через `@@unique([provider, externalId, signature])`.
- **PaymentLog** — аудит запросов к Uniteller с маскированными картами.
- **SavedCard** — токенизация (`uniteller_customer_idp` + `uniteller_card_idp`), опциональна в v1.
