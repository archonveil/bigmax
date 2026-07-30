# Бигмах — интернет-магазин

**Live:** [domtextile.uz/ru](https://domtextile.uz/ru)

Полнофункциональный интернет-магазин с доставкой по Узбекистану: каталог с фильтрами и поиском, корзина и избранное, оформление заказа с онлайн-оплатой (Uniteller), личный кабинет с историей заказов, промокоды и программа лояльности, отзывы, admin-панель и мультиязычность (ru / uz / en).

> **EN:** Production e-commerce platform for Uzbekistan (live at domtextile.uz). pnpm monorepo: Next.js 14 storefront, Fastify API, BullMQ worker; Prisma/PostgreSQL, Redis, MinIO. Built AI-agent-first with Claude Code (31/41 commits AI-co-authored), verified by CI (typecheck / lint / tests / build) and a separate Playwright e2e pipeline.

## Ключевые возможности

- **Каталог** — 2-уровневые категории, URL-driven фильтры (цена/бренд/возраст/пол/наличие), сортировка, Quick View, поиск с автодополнением (ILIKE по 3 локалям)
- **Заказы и оплата** — корзина, checkout, интеграция с платёжным шлюзом Uniteller, история и отслеживание заказов
- **Аутентификация** — NextAuth v5: email+password и OTP по телефону (Eskiz.uz), role-based middleware (customer / manager / admin)
- **Админка** — управление товарами, заказами, промо и контентом
- **Курс валют** — UZS/USD в реальном времени от ЦБ Узбекистана с кэшем в Redis
- **SEO** — hreflang × 3 локали, JSON-LD (Product / Offer / BreadcrumbList), динамический sitemap
- **Качество** — GitHub Actions CI (typecheck / lint / format / tests / build + проверка синхронности переводов) и отдельный e2e-пайплайн на Playwright; husky + commitlint

Подробный лог фаз разработки: [docs/PROGRESS.md](docs/PROGRESS.md)

## Быстрый старт

```bash
corepack enable                 # pnpm
pnpm install
cp .env.example .env            # заполнить настройки (см. ниже)
pnpm run docker:up              # Postgres, Redis, MinIO, Mailhog, Adminer, Uniteller mock
pnpm db:migrate && pnpm db:seed # схема + демо-данные
pnpm dev                        # http://localhost:3000
```

Проверки перед коммитом выполняются автоматически (husky + lint-staged); вручную — `pnpm typecheck && pnpm lint && pnpm test`, e2e — `pnpm e2e`.

## Настройки (.env)

Все переменные окружения описаны с комментариями в [`.env.example`](.env.example). Основные группы:

| Группа      | Переменные                          | Назначение                                                     |
| ----------- | ----------------------------------- | -------------------------------------------------------------- |
| App / SEO   | `APP_URL`, `NEXT_PUBLIC_SITE_URL`   | канонический хост для metadataBase, hreflang, sitemap, JSON-LD |
| База и кеш  | `DATABASE_URL`, `REDIS_URL`         | PostgreSQL (Prisma) и Redis (кеш + BullMQ)                     |
| Auth        | `AUTH_SECRET`, `AUTH_URL`           | NextAuth v5; секрет — `openssl rand -base64 32`                |
| Хранилище   | `S3_ENDPOINT`, `S3_*`               | MinIO в dev, S3-совместимое в prod, bucket `bigmax-media`      |
| Платежи     | `UNITELLER_*`                       | шлюз Uniteller (в dev — mock на :8787)                         |
| Уведомления | `ESKIZ_*`, `TELEGRAM_*`, `RESEND_*` | SMS, Telegram-бот, email                                       |
| Карты       | `NEXT_PUBLIC_YANDEX_MAPS_API_KEY`   | опционально; без ключа — Leaflet-fallback                      |

Секреты не коммитятся: в репозитории только `.env.example` с плейсхолдерами.

## Стек

- **Фронтенд:** Next.js 14 (App Router) + TypeScript (strict) + Tailwind CSS + shadcn/ui + Zustand + TanStack Query
- **Бэкенд:** Next.js Route Handlers / Fastify API + WebSocket
- **БД:** PostgreSQL (Prisma ORM), Redis (кеш + BullMQ)
- **Платежи:** **Uniteller** (единственный эквайер) + наложенный платёж (COD)
- **Авторизация:** NextAuth.js (OTP через Eskiz.uz + email/пароль)
- **i18n:** next-intl, локали `ru` (default), `uz`, `en`
- **Хранилище:** S3-совместимое (MinIO в dev, AWS S3/Uzcloud в prod), bucket `bigmax-media`
- **Уведомления:** Telegram Bot (@bigmax_shop_bot), SMS (Eskiz.uz, sender `BIGMAX`), Email (Resend)

## Требования

- Node.js ≥ 20.11 (см. `.nvmrc`)
- pnpm ≥ 9.0
- Docker + Docker Compose (для Postgres / Redis / MinIO / Mailhog / Uniteller mock в dev — появится в P0-T2)

## Установка

```bash
pnpm install
cp .env.example .env  # и заполнить
pnpm run docker:up    # Postgres, Redis, MinIO, Mailhog, Adminer, Uniteller mock
```

## Dev-окружение (Docker)

Все зависимости раннера поднимаются одним `docker compose`. Сервисы:

| Сервис         | Порт | URL / подключение                                          |
| -------------- | ---- | ---------------------------------------------------------- |
| PostgreSQL 16  | 5432 | `postgresql://bigmax:bigmax@localhost:5432/bigmax`         |
| Redis 7        | 6379 | `redis://localhost:6379`                                   |
| MinIO (S3)     | 9000 | `http://localhost:9000` (API), bucket `bigmax-media`       |
| MinIO console  | 9001 | `http://localhost:9001` (bigmax / bigmax-secret-change-me) |
| Mailhog SMTP   | 1025 | SMTP для dev-писем                                         |
| Mailhog UI     | 8025 | `http://localhost:8025`                                    |
| Adminer        | 8080 | `http://localhost:8080` (server: `postgres`)               |
| Uniteller mock | 8787 | `http://localhost:8787` (`/pay/`, `/results/`, `/cancel/`) |

Команды:

```bash
pnpm run docker:up      # поднять стек в фоне
pnpm run docker:down    # остановить
pnpm run docker:logs    # tail логов
pnpm run docker:ps      # статус сервисов
pnpm run docker:reset   # удалить volume'ы (ВНИМАНИЕ: уничтожает данные)
```

Бакет `bigmax-media` создаётся автоматически init-контейнером `minio-init` с публичным download ACL.

Uniteller mock — минимальный стаб (возвращает HTML-страницу выбора исхода на `POST /pay/`, фиктивный XML на `GET /results/` и `POST /cancel/`). Полная логика (проверка подписи, тестовые карты, callback'и, таймауты) будет в P4-T12.

## E2E тесты (Playwright)

```bash
# первый раз — скачать браузеры (~300 MB, кешируется в ~/.cache/ms-playwright)
pnpm --filter @bigmax/web run e2e:install

# локальный прогон (Playwright сам поднимает dev на 3030)
pnpm --filter @bigmax/web run e2e

# интерактивный UI-режим с трейсом
pnpm --filter @bigmax/web run e2e:ui

# против уже поднятого сервера
E2E_BASE_URL=http://localhost:3030 pnpm --filter @bigmax/web run e2e
```

Тесты лежат в [`apps/web/e2e/`](apps/web/e2e). Требуют поднятый `docker:up` (Postgres для создания/удаления эфемерных тест-юзеров, Redis для OTP).

## Worker (BullMQ jobs)

Long-running Node-процесс с BullMQ-очередями. На P4-T9 регистрирует один repeatable job `check-pending-payments` (раз в минуту pull-проверка зависших Uniteller-платежей через `/results/`); в P4-T10 добавится notification-очередь.

```bash
# 1. Поднять Redis + Postgres (если ещё не подняты)
pnpm run docker:up

# 2. Сидить БД (если первый запуск)
pnpm --filter @bigmax/db run db:migrate
pnpm --filter @bigmax/db run db:seed

# 3. Запустить worker (hot-reload через tsx watch)
pnpm run worker:dev

# Без hot-reload, как в проде:
pnpm run worker:start
```

Все секреты worker берёт из корневого `.env` через `dotenv-cli`. Если `UNITELLER_AUTH_LOGIN/PASSWORD` пусты — job логирует warn и возвращает `{scanned: 0}` (dev-окружение без боевых credentials).

Наблюдаемость: ошибки идут через `apps/worker/src/observability.ts::reportError` → `console.error`. С наличием `SENTRY_DSN` ставится тег `[sentry-stub]` (полная Sentry-интеграция — P4-T11 / P8-T3).

В prod worker запускается отдельным контейнером/процессом (PM2 или docker-compose); следующий релиз P4-T10 добавит `apps/worker/Dockerfile`.

## Структура монорепо

```
apps/
  web/              @bigmax/web            — Next.js 14 (витрина + API routes)
  api/              @bigmax/api            — опциональный Fastify API
  worker/           @bigmax/worker         — BullMQ воркеры (уведомления, платежи, PDF)
packages/
  ui/               @bigmax/ui             — shadcn/ui-компоненты общего назначения
  shared-types/     @bigmax/shared-types   — Zod-схемы, brand.ts, locales.ts
  payments/         @bigmax/payments       — Uniteller client, signature, webhook, COD
  notifications/    @bigmax/notifications  — Telegram / SMS / Email шаблоны
  i18n/             @bigmax/i18n           — next-intl конфиг и словари ru/uz/en
```

## Скрипты

```bash
pnpm dev           # dev-сервер всех приложений (параллельно)
pnpm web:dev       # только Next.js storefront
pnpm worker:dev    # только BullMQ worker (P4-T9 pull-проверка платежей)
pnpm build         # prod-билд всех пакетов
pnpm lint          # ESLint
pnpm format        # Prettier
pnpm typecheck     # TypeScript strict
pnpm test          # Vitest unit + Playwright e2e
```

## Коммиты

Используем Conventional Commits. Husky + commitlint проверяют формат автоматически.

```
<type>(<scope>): <subject>

feat(checkout): add Uniteller payment flow
fix(cart): prevent negative quantities
i18n(catalog): add uz translations for filters
payments(uniteller): verify callback signature
```

Доступные scopes: `web`, `api`, `worker`, `ui`, `shared-types`, `payments`, `notifications`, `i18n`, `db`, `auth`, `cart`, `checkout`, `uniteller`, `admin`, `deps`, `config`, `ci`, `release`.

## Бренд

- Название (RU): **Бигмах** · Название (LA): **Bigmax**
- Домен: **bigmax.uz**
- Email: info@bigmax.uz · support@bigmax.uz · orders@bigmax.uz
- Telegram: канал @bigmax_uz, бот @bigmax_shop_bot
- Instagram: @bigmax.uz

## Безопасность

- Секреты Uniteller (`UNITELLER_PASSWORD`, `UNITELLER_AUTH_*`) — **только серверные**. Никогда в клиентский код и `NEXT_PUBLIC_*`.
- Подпись Uniteller всегда вычисляется на сервере.
- Логи платежей — в `PaymentLog` с маскированием PAN (показываем только `last4`).
- Все запросы к Uniteller — HTTPS, timeout 30 сек, retry 3x для идемпотентных операций.
