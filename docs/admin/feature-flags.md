# Feature-флаги в Бигмах · Гайд для новичков

> Связано: P7-T2 sub-tasks F/G/H/I/J/K/L/M/N/O. Полная история — в [README.md](../../README.md).
> Runbook отката enum-миграции: [`loyalty-type-rollback.md`](../runbooks/loyalty-type-rollback.md).

Этот документ объясняет систему runtime feature-флагов магазина так, чтобы
человек, впервые открывший проект, мог:

- понять _зачем_ они нужны,
- найти их в UI (`/admin/features`),
- безопасно поменять значение,
- добавить новый флаг,
- найти, кто и что менял (audit),
- посмотреть, что ещё можно улучшить (roadmap внизу).

---

## 1. Что такое feature-флаг

**Простая аналогия:** это «переключатель» в БД, который меняет поведение
сайта _без переразвёртывания_ кода. Развернули новую функцию, что-то пошло
не так — admin зашёл в `/admin/features`, выключил флаг, через минуту всё
снова работает как раньше. Без миграций, без перезагрузки серверов, без
ожидания CI.

**В Бигмах** флаги нужны для трёх типов сценариев:

| Сценарий              | Пример                                                               |
| --------------------- | -------------------------------------------------------------------- |
| Маркетинговая акция   | Поднять `loyalty.earn_percent` с 1% до 5% на Black Friday            |
| Emergency-disable     | Выключить `loyalty.spend_enabled` при инциденте с фродом             |
| Глобальное оповещение | Зажечь banner `brand.maintenance_message` на время технических работ |

---

## 2. Какие флаги есть сейчас

Открываем `/ru/admin/features` (admin-роль обязательна) и видим таблицу:

| Ключ                        | Тип       | Default | Что делает                                                                                     |
| --------------------------- | --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `brand.maintenance_message` | `string`  | `""`    | Текст banner'а поверх всех страниц. Пусто = banner скрыт.                                      |
| `loyalty.earn_percent`      | `number`  | `1`     | % начисления баллов «Бигмах Бонус» от суммы заказа.                                            |
| `loyalty.spend_enabled`     | `boolean` | `true`  | Глобальный kill-switch на списание баллов в checkout. `false` → spend выключен, earn работает. |

> Все три row'а заведены миграциями
> ([20260511220000_features_table](../../packages/db/prisma/migrations/20260511220000_features_table/migration.sql),
> [20260511230000_feature_loyalty_spend_enabled](../../packages/db/prisma/migrations/20260511230000_feature_loyalty_spend_enabled/migration.sql),
> [20260511240000_feature_brand_maintenance_message](../../packages/db/prisma/migrations/20260511240000_feature_brand_maintenance_message/migration.sql)).
> **Новые флаги тоже добавляются миграциями, а не через UI** — UI меняет
> только `value`, не `key`/`type`. Это защищает код от опечаток в ключах.

---

## 3. Как поменять значение (для admin'а)

1. Заходим под admin-аккаунтом на `/ru/admin/features`.
2. Кликаем по ключу в первой колонке → попадаем на `/ru/admin/features/<key>`.
3. Меняем значение в форме (input адаптируется под тип):
   - `number` → числовой input
   - `boolean` → две радио-кнопки «Да / Нет»
   - `string` → текстовый input
4. Нажимаем «Сохранить».
5. Видим toast «Feature обновлён. Кэш сброшен.» — за следующие пол-минуты
   новое значение подхватится на всех серверах сайта.

> Если поменяли row напрямую через SQL (out-of-band), нажмите кнопку
> **«Очистить кэш»** в шапке edit-страницы — она дёрнет
> `POST /api/admin/features/<key>/invalidate`, и Redis-кэш протухнет
> мгновенно.

---

## 4. Как работает кэш

```
┌──────────┐       ┌────────────┐      ┌───────────┐
│  Сервер  │ ─get→ │ Redis      │ ─miss→│ Postgres  │
│ (web)    │ ←val─ │ TTL = 60s  │ ←row─ │ features  │
└──────────┘       └────────────┘      └───────────┘
                         ↑
                         │ DEL (PATCH или Invalidate-button)
                         │
                   ┌─────┴─────┐
                   │  Admin UI │
                   └───────────┘
```

- Ключ в Redis: `feature:v1:<key>` (например, `feature:v1:loyalty.earn_percent`).
- TTL: **60 секунд**. Через минуту запрос пойдёт в Postgres повторно.
- При PATCH через UI cache busts сам.
- При прямом SQL UPDATE кэш не busts — отсюда кнопка «Очистить кэш».
- Если Redis недоступен — fail-safe: каждый запрос идёт в Postgres
  (медленнее, но не падает).

---

## 5. Где это в коде

| Слой             | Файл                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema           | [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) — `model Feature`                                                                                                                        |
| Cache + readers  | [`apps/web/src/server/features.ts`](../../apps/web/src/server/features.ts) — `getNumberFeature` / `getBooleanFeature` / `getStringFeature` / `invalidateFeatureCache`                                                 |
| Admin server lib | [`apps/web/src/server/admin-features.ts`](../../apps/web/src/server/admin-features.ts) — Zod, list/get helpers, `validateFeatureValue`                                                                                |
| API              | [`apps/web/src/app/api/admin/features/[key]/route.ts`](../../apps/web/src/app/api/admin/features/[key]/route.ts) — PATCH + audit-log                                                                                  |
| API (invalidate) | [`apps/web/src/app/api/admin/features/[key]/invalidate/route.ts`](../../apps/web/src/app/api/admin/features/[key]/invalidate/route.ts)                                                                                |
| UI list          | [`apps/web/src/app/[locale]/admin/features/page.tsx`](../../apps/web/src/app/[locale]/admin/features/page.tsx)                                                                                                        |
| UI edit          | [`apps/web/src/app/[locale]/admin/features/[key]/page.tsx`](../../apps/web/src/app/[locale]/admin/features/[key]/page.tsx)                                                                                            |
| Form             | [`apps/web/src/components/admin/features/feature-form.tsx`](../../apps/web/src/components/admin/features/feature-form.tsx)                                                                                            |
| Tests            | [`features.test.ts`](../../apps/web/src/server/features.test.ts), [`admin-features.test.ts`](../../apps/web/src/server/admin-features.test.ts), [`admin-features.spec.ts`](../../apps/web/e2e/admin-features.spec.ts) |

---

## 6. Как добавить новый флаг (для разработчика)

Пример: добавляем `cart.free_delivery_threshold_cents` — порог бесплатной
доставки.

### Шаг 1 — Миграция

```sql
-- packages/db/prisma/migrations/YYYYMMDDHHMMSS_feature_free_delivery_threshold/migration.sql
INSERT INTO "features" ("key", "value", "type", "description") VALUES
  ('cart.free_delivery_threshold_cents', '5000000', 'number',
   'Порог бесплатной доставки в тийнах. Default 5_000_000 = 50_000 сум.');
```

Применяем: `pnpm --filter @bigmax/db exec dotenv -e ../../.env -- prisma migrate deploy`.

### Шаг 2 — Helper в коде

```ts
// apps/web/src/server/cart-features.ts
import { getNumberFeature } from "@/server/features";

export const FREE_DELIVERY_FEATURE_KEY = "cart.free_delivery_threshold_cents";

export async function getFreeDeliveryThresholdCents(): Promise<number> {
  return getNumberFeature(FREE_DELIVERY_FEATURE_KEY, 5_000_000); // fallback
}
```

### Шаг 3 — Использование

```ts
// где-то в checkout/pay route
const threshold = await getFreeDeliveryThresholdCents();
if (subtotalCents >= threshold) deliveryCents = 0;
```

### Шаг 4 — Тест на feature-key

```ts
// apps/web/src/server/cart-features.test.ts
import { FREE_DELIVERY_FEATURE_KEY } from "./cart-features";

it("ключ совпадает с seed-row", () => {
  expect(FREE_DELIVERY_FEATURE_KEY).toBe("cart.free_delivery_threshold_cents");
});
```

### Шаг 5 — Проверить в UI

Зайти на `/ru/admin/features` — новая row должна появиться в таблице
автоматически (UI читает всё из `prisma.feature.findMany`).

---

## 7. Кто и что менял — audit

Все изменения пишутся в `PaymentLog` под action `feature.updated` (PATCH) и
`feature.cache_invalidated` (кнопка). Смотреть на странице
`/ru/admin/audit?group=feature` — будет видна timeline:

```
2026-05-11 14:23:45 · feature.updated · admin@bigmax.uz
  key: loyalty.earn_percent
  oldValue: "1"  newValue: "5"

2026-05-11 14:24:01 · feature.cache_invalidated · admin@bigmax.uz
  key: loyalty.earn_percent
```

---

## 8. Roadmap (что ещё можно сделать)

Стабильные ID — `FF-NNN`, без коллизий с проектными `P#-T#` или
`OPT-NNN`-оптимизациями. Effort = grubый estimate (XS < 1ч, S < 4ч, M
< 1 день, L > 1 день). Priority = моя субъективная оценка ROI.

### High priority — day-to-day usability

- [x] **FF-001** ✅ _Inline toggle для boolean'ов в списке_. Один клик в таблице переключает `true ↔ false` без захода на edit-страницу. [`<FeatureInlineToggle>`](../../apps/web/src/components/admin/features/feature-inline-toggle.tsx) — client component, optimistic UI + `useTransition` для pending-state, revert + toast на ошибке, `router.refresh` на успехе. Wired в `/admin/features` list для type=boolean rows.
- [x] **FF-002** ✅ _Per-feature audit timeline на edit-странице_. `getFeatureAuditLog(key)` в [`server/admin-features.ts`](../../apps/web/src/server/admin-features.ts) читает `PaymentLog.where({ action: startsWith "feature." })` с in-memory JSON-filter по `request.key`. [`<FeatureAuditTimeline>`](../../apps/web/src/components/admin/features/feature-audit-timeline.tsx) — server component под формой; рендерит до 20 последних записей `feature.updated` (с `oldValue → newValue` diff) и `feature.cache_invalidated`, иконки `Pencil` / `RotateCcw`.
- [x] **FF-003** ✅ _Confirmation modal для high-risk flags_. Pure helper [`isHighRiskFeatureChange`](../../apps/web/src/lib/feature-risk.ts) (вынесен в `@/lib/` чтобы client-form не тянул Prisma): `loyalty.spend_enabled → false` → high-risk, `brand.maintenance_message → non-empty` → high-risk, `loyalty.earn_percent > 5` → high-risk. `<FeatureForm>` теперь gate'ит submit через `<AlertDialog>` (shadcn) с diff-preview `was: X → will: Y` для double-check. 9 unit-тестов на helper. Re-export из `server/admin-features.ts` для backward-compat.

### Medium priority — convenience

- [ ] **FF-004** · _Search / filter в списке_ (effort: S, priority: medium). Input для поиска по `key`-prefix (например, `loyalty.*`). Сейчас 3 row, но при 20+ становится важно. Также фильтр по type.
- [x] **FF-005** ✅ _«Откатить»-button в audit timeline_. [`<RevertButton>`](../../apps/web/src/components/admin/features/revert-button.tsx) — icon-button (`<Undo2>`) у каждой `feature.updated`-row в timeline'е. Клик → confirmation `<AlertDialog>` с diff `current → targetValue` → PATCH через тот же endpoint что использует `<FeatureForm>` → toast + `router.refresh`. Семантика: revert = «вернуть значение, которое БЫЛО ДО этой конкретной log-row» = `oldValue` той записи. Дисэйблится если target = current (no-op). Пропускается для `cache_invalidated` rows (нечего возвращать) и для `updated` rows без `oldValue` (старый audit-payload). Записывается как новый PATCH в audit — undo тоже история.
- [ ] **FF-006** · _Diff preview перед submit_ (effort: XS, priority: medium). В форме рядом с input'ом показываем `was: "1" → will be: "5"` пока не нажат submit. Защита от опечаток.
- [ ] **FF-007** · _Inline help / docs links_ (effort: XS, priority: medium). Кликабельная иконка `?` рядом с description, открывает соответствующий runbook (например, `docs/runbooks/loyalty-emergency.md` для `loyalty.*`).

### Medium priority — type extensions

- [ ] **FF-008** · _Новый тип `json`_ (effort: M, priority: medium). Для сложных конфигов: `loyalty.tier_thresholds: [{tier:"gold", points:1000}]`. Form будет показывать textarea с JSON validation; reader — `getJsonFeature<T>(key, fallback, zodSchema)` с runtime-проверкой через Zod.
- [ ] **FF-009** · _Новый тип `enum`_ (effort: M, priority: medium). Value — один из предопределённого списка. `Feature.allowedValues String[]` или `enum_options Json`; form рендерит `<Select>`. Защита от опечаток.
- [ ] **FF-010** · _Per-feature validation rules в БД_ (effort: M, priority: medium). Min/max/regex stored как `Feature.constraints Json`. `validateFeatureValue` подхватывает их и применяет помимо type-check. Полезно: `loyalty.earn_percent: { min: 0.01, max: 50 }`.

### Lower priority — governance & access

- [x] **FF-011** ✅ _Per-flag role gate_. Pure helper [`canChangeFeature(role, key)`](../../apps/web/src/lib/feature-permissions.ts): `loyalty.*` → только `admin`, остальное → admin/manager. Захардкожен в коде (как `feature-risk.ts` от FF-003) — добавление правила = code-review. **API**: PATCH + invalidate routes отдают 403 `forbidden_for_role` для unauthorized. **UI**: list-page прячет inline-toggle для protected ключей (плоский text вместо `<Switch>`), edit-page показывает amber gate-banner с current value + объяснением вместо формы. 8 unit-тестов на `canChangeFeature` (admin может всё, manager блокирован на `loyalty.*`, startsWith-edge-cases).
- [ ] **FF-012** · _Required reason field в PATCH_ (effort: S, priority: medium). Обязательное поле «причина изменения» в форме (паттерн от order status change / refund). Записывается в audit-log. Помогает на post-incident review.
- [ ] **FF-013** · _Two-eyes approval_ (effort: L, priority: low). Change requires second admin's confirmation для prod-critical flags. Pending-changes таблица + approve/reject endpoint. Сложно, но безопасно.

### Power features (большая работа)

- [ ] **FF-014** · _Scheduled changes_ (effort: M, priority: low). «Установить значение X в момент Y» — admin задаёт future-effective-from. BullMQ cron worker (P4-T9 паттерн) применяет в нужное время. Use-case: «Black Friday percent с 00:00 пятницы».
- [ ] **FF-015** · _A/B testing / cohort-based values_ (effort: L, priority: low). `loyalty.earn_percent` зависит от `user.id % 100 < N`. Полноценный flag-management как LaunchDarkly. Большая работа, обычно используют SaaS-сервисы.
- [ ] **FF-016** · _Per-environment values (prod / staging / dev)_ (effort: M, priority: low). Колонка `env` в `features`; reader выбирает row по `process.env.NODE_ENV`. Только если будут расхождения между env'ами.
- [ ] **FF-017** · _Webhooks на change_ (effort: M, priority: low). POST в внешний URL когда flag меняется (для notifying других сервисов / Slack / Telegram). Чуть-чуть переплетается с P4-T10 notification-стек.

### Когда брать что

- **Сейчас**: FF-001, FF-002, FF-003 — поднимут реальный UX страницы на следующий уровень.
- **При 10+ флагах**: FF-004 (search), FF-007 (help links).
- **Перед production-запуском**: FF-003 (confirmation), FF-011 (per-flag role), FF-012 (required reason).
- **Когда понадобится сложная конфигурация**: FF-008 (json), FF-009 (enum).
- **Power features**: только когда есть конкретный use-case в продакшене. Не делать заранее.
