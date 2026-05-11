# Бигмах (bigmax.uz) — Optimization Plan

> Working document for systematic performance work. Findings anchored to file +
> line numbers; impact estimates are order-of-magnitude based on round-trip
> count and payload size, **not measured**. Treat them as priorities, not
> commitments.
>
> **Project-phase mapping (см. CLAUDE.md §8).**
> The plan as a whole belongs under launch-readiness:
>
> - **P8-T1** — нагрузочное тестирование (validates that the wins land in real RPS).
> - **P8-T3** — observability (alerts on perf regressions, webhook lag, etc.).
>
> Individual findings touch code that _originally_ shipped under earlier
> phases (P2 catalog, P4 checkout/payments, P6 admin) — the `Project phase`
> column on each item points at the owning phase so backports go to the right
> milestone.
>
> **Scope:** server-side data fetching, DB query patterns, caching, Suspense
> streaming, client bundle weight, image pipeline.
> **Out of scope:** framework migrations, BigInt money architecture (already
> landed), CDN/edge infra, tests/CI timing.

## ID convention

Optimization finding IDs are `OPT-NNN` (3-digit, sequential). Priority is a
side-label (`H` / `M` / `L`), **not** encoded in the ID — this avoids the
visual collision with project Phase-Task IDs (`P0-T1`, `P8-T3`) from the spec.

`OPT-001`..`OPT-009` were originally `P0-1`..`P0-9` (high prio).
`OPT-010`..`OPT-024` were originally `P1-10`..`P1-24` (medium).
`OPT-025`..`OPT-032` were originally `P2-25`..`P2-32` (low).
The numbering is preserved verbatim so git-history grep still works.

---

## Section 1 — Findings

### OPT-001 · H · open · project P4 (checkout)

**N+1 in stock movement helpers blowing up checkout TX.**

- Files: [`apps/web/src/server/order-stock-movement.ts:116-162`](apps/web/src/server/order-stock-movement.ts#L116-L162), `:179-229`, `:246-296`
- Problem: `reserveOrderStock` / `releaseOrderStock` / `commitOrderShipment` iterate `order.items` with sequential `findUnique` + `update` + `create` per item inside the outer `$transaction`. A 6-item order ≈ 18 DB round-trips.
- Impact: ~50–120 ms × items; 6-item order wastes 300–700 ms in serial I/O. Expands lock window on `Stock` rows.
- Fix:
  1. One `prisma.stock.findMany({ where: { branchId, variantId: { in } } })` up front; build a `Map`.
  2. `Promise.all(stock.update(...))` inside the TX (Prisma pipelines independent updates within the coroutine).
  3. `prisma.stockLog.createMany` for audit rows (one round-trip).
- Effort: M

### OPT-002 · H · open · project P2 (catalog) / P6 (admin)

**`getCategoryAttributes` walks parent chain with sequential queries.**

- Files: [`apps/web/src/server/category-attributes.ts:168-185`](apps/web/src/server/category-attributes.ts#L168-L185), `:196-212`
- Problem: `getCategoryAncestorChain` does `findUnique` per level in a `for` loop. 3-level taxonomy = 3 round-trips, plus per-ancestor calls in `getOwnCategoryAttributes`. The 5-min cache mitigates warm path; cold cache (after admin edit / redeploy) pays ~6 round-trips per category page.
- Impact: ~150–250 ms cold cache on `/catalog/[slug]` and `/product/[slug]`. Cache invalidation spike after admin edits.
- Fix: recursive CTE via `prisma.$queryRaw`; or fall back to existing `getCategoryAttributesMap` (2 queries) for hot paths. Better: denormalised `Category.path` array maintained on write.
- Effort: M

### OPT-003 · H · done (2026-05-09) · project P2 (catalog)

**`searchWhere` ILIKE without trigram index → full-table scan.**

- Resolved via migration `20260509140000_phase1_indexes` (see Wave 1 / item (1)). Trigram extension + GIN on `products(name_ru || name_uz || name_en)` and `users(email)`.
- Original references: [`apps/web/src/server/catalog.ts:641-651`](apps/web/src/server/catalog.ts#L641-L651), schema `packages/db/prisma/schema.prisma`.

### OPT-004 · H · open · project P6 (admin)

**Bulk endpoints execute one TX per row.**

- Files: [`apps/web/src/app/api/admin/stock/bulk-adjust/route.ts:79-111`](apps/web/src/app/api/admin/stock/bulk-adjust/route.ts#L79-L111), [`apps/web/src/app/api/admin/stock/import/route.ts:97-150`](apps/web/src/app/api/admin/stock/import/route.ts#L97-L150)
- Problem: up to 200 (1000 for import) rows, each opens its own transaction with `update` + `create`. 200 rows ≈ 600 round-trips.
- Impact: 200-row bulk-adjust ≈ 5–10 s wall-clock; 1000-row import 30–60 s.
- Fix: build all `(stockId, newQty)` pairs first; one `prisma.$transaction([...])` with all updates + a single `stockLog.createMany`. Eliminate redundant `findUnique` at line 113-116 by using pre-fetched `existing` map.
- Effort: M

### OPT-005 · H · done (2026-05-09) · project P6 (admin)

**Concurrent `writePaymentLog` instead of `createMany`.**

- Resolved via new helper `writePaymentLogs([...])` (one `paymentLog.createMany`). Wired into `/api/admin/customers/bulk-role/route.ts` and `/api/admin/orders/bulk/route.ts`. See Wave 1 / item (4).

### OPT-006 · H · done (2026-05-09) · project P2 (catalog)

**`PRODUCT_CARD_SELECT.variants.stock` over-fetches every Stock row.**

- Resolved via `fetchAvailableByVariant` + `buildCardsWithStock` in [`apps/web/src/server/catalog.ts`](apps/web/src/server/catalog.ts) — one `groupBy` per listing. Applied to `getFeaturedProducts`, `getProductsByCategory`, `getSearchSuggestions`, `searchProducts`. See Wave 2 / item (6).

### OPT-007 · H · done (2026-05-09) · project P2 (catalog)

**`getProductsByCategory` materializes everything for price-sort.**

- Resolved by switching the price-sort branch in `getProductsByCategory` to `productVariant.groupBy({ orderBy: { _min: { priceCents } } })` with `skip` / `take`, then a single `findMany({ where: { id: { in } } })` for the page. **Verified**: Prisma 5.22 supports `_min` ordering inside `groupBy` even though `findMany`'s nested `orderBy: { variants: { _min: ... } }` is still not supported. See Wave 2 / item (7).

### OPT-008 · H · done (2026-05-09) · project P6 (admin)

**`Order.payments` `take: 1` lacks composite index.**

- Resolved via composite index `payments(orderId, createdAt DESC)` in migration `20260509140000_phase1_indexes`. See Wave 1 / item (1).

### OPT-009 · H · open · project P4 (checkout)

**`nextOrderSequenceForDay` LIKE prefix scan + retry race.**

- Files: [`apps/web/src/server/orders.ts:25-45`](apps/web/src/server/orders.ts#L25-L45), used in [`apps/web/src/app/api/checkout/pay/route.ts:313`](apps/web/src/app/api/checkout/pay/route.ts#L313).
- Problem: `findFirst({ where: { number: { startsWith: prefix } } })` per checkout. Two concurrent checkouts on the same day always collide on read-modify-write. 5-attempt retry cap = realistic failure mode under traffic spike.
- Impact: today acceptable; at 100+ orders/day expects 1–2 retries per concurrent checkout pair (30–80 ms).
- Fix: `daily_order_counters` table with `INSERT … ON CONFLICT (day) DO UPDATE SET counter = counter + 1 RETURNING counter`. One round-trip, atomic, no retry.
- Effort: M

---

### OPT-010 · M · open · project P3 (cart) / P7 (promo)

**`validatePromoCode` mismatch + no cache.**

- Files: [`apps/web/src/app/api/promo/validate/route.ts:45-58`](apps/web/src/app/api/promo/validate/route.ts#L45-L58), [`apps/web/src/server/promo.ts:34-47`](apps/web/src/server/promo.ts#L34-L47)
- Problem: route uses `findUnique` (case-exact); checkout-side `validatePromoCode` uses `findFirst({ mode: "insensitive" })` — different code path, can't use unique index. Neither caches.
- Impact: 10–30 ms per validate, multiplied by every keystroke without client debounce.
- Fix: standardise on `findUnique({ where: { code: trimmed.toUpperCase() } })`. Redis cache `promo:<code>` 60s TTL with admin-CRUD invalidation.
- Effort: S

### OPT-011 · M · done (2026-05-09) · project P4 (checkout)

**`/checkout/page.tsx` refetched branches on every render.**

- Resolved via `unstable_cache(getActiveBranches, ['active-branches'], { revalidate: 600, tags: ['branches'] })` in [`server/active-branches.ts`](apps/web/src/server/active-branches.ts); `revalidateTag('branches')` from admin branches CRUD. Same pattern applied to brands/categories/category-tree (see also OPT-025). See Wave 1 / item (2).

### OPT-012 · M · done (2026-05-09) · project P2 (catalog)

**Home page sequential awaits, no Suspense streaming.**

- Resolved at [`/[locale]/page.tsx`](apps/web/src/app/[locale]/page.tsx) — categories / featured / brands each in their own `<Suspense>` boundary with shape-matched skeleton fallbacks; hero ships immediately. See Wave 2 / item (5).

### OPT-013 · M · open · project P6 (admin)

**Dashboard sub-components fetch translations sequentially.**

- File: [`apps/web/src/app/[locale]/admin/page.tsx:48-79`](apps/web/src/app/[locale]/admin/page.tsx#L48-L79)
- Problem: five async sub-components each call `getTranslations(...)` after parent already awaited `getDashboardStats`.
- Impact: 5 × translation loads serial; ~10–30 ms total.
- Fix: hoist `getTranslations("admin.dashboard")` once; pass `t` namespace down; convert children to sync.
- Effort: XS

### OPT-014 · M · done (2026-05-09) · project P6 (admin)

**`aggregateRevenue` lacks composite indexes.**

- Resolved via `orders(status, createdAt)` and `order_items(variantId, orderId)` composites in migration `20260509140000_phase1_indexes`. See Wave 1 / item (1). Production `EXPLAIN ANALYZE` still pending (open question in Section 3).

### OPT-015 · M · done (2026-05-09) · project P6 (admin)

**Dashboard top-products revenue is wrong (and slow).**

- Resolved: replaced `prisma.orderItem.groupBy` + `qty × _sum.priceCents` JS arithmetic in [`apps/web/src/server/admin-dashboard.ts`](apps/web/src/server/admin-dashboard.ts) with one `$queryRaw` that computes `SUM(quantity × price_cents)` per variant. Bonus side-effect: fixes the BigInt-multiplication runtime crash that surfaced after the money-to-bigint migration (raw query returns both columns as `bigint` consistently; coerce once at the boundary with `Number(...)`).

### OPT-016 · M · done (2026-05-09) · project P2 (catalog)

**`getAllAttributeKeys` per-process cache, no Redis.**

- Resolved via `unstable_cache` (1h TTL, tag `attributes`), invalidated from admin attribute mutations. See Wave 1 / item (2).

### OPT-017 · M · open · project P5 (order history)

**Order detail does payments + refunds in 2 round-trips.**

- File: [`apps/web/src/server/account-order-detail.ts:100-188`](apps/web/src/server/account-order-detail.ts#L100-L188)
- Problem: comment explains: nested include `payments → refunds` duplicates rows. So manual two-query pattern. Each order page = 2 sequential queries.
- Impact: 30–60 ms extra per order page.
- Fix: **first verify** Prisma 5.22 still duplicates with consistent `select`. If not, collapse to one query.
- Effort: XS

### OPT-018 · M · done (2026-05-09) · project P1 (auth/account)

**`/account/profile` did redundant user lookup despite JWT.**

- Resolved: added `name` and `email` to JWT `jwt` callback in [`apps/web/src/auth/config.ts`](apps/web/src/auth/config.ts); profile page renders from session only; `useSession().update(...)` keeps the token fresh after edits. See Wave 1 / item (3).

### OPT-019 · M · transitive · project P2 (catalog)

**Sequential `getProductBySlug` then `getCategoryAttributes`.**

- File: [`apps/web/src/app/api/products/[slug]/route.ts:31-35`](apps/web/src/app/api/products/[slug]/route.ts#L31-L35)
- Problem: sequential because attributes depend on category. Inner `getCategoryAttributes` walks ancestors serially (OPT-002). Fixed transitively when OPT-002 lands.

### OPT-020 · L · deferred · project P6 (admin)

**Naive `parseCsv` (no quoted-field support).**

- File: [`apps/web/src/server/admin-products.ts:249-283`](apps/web/src/server/admin-products.ts#L249-L283)
- Not a perf issue — flagged for **P8** general quality pass. Names with commas silently corrupt. Out of scope for this plan.

### OPT-021 · M · open · project P2 (catalog)

**`next/image` optimization on Cloudinary URLs adds CPU.**

- File: [`apps/web/src/components/catalog/product-card.tsx:66-72`](apps/web/src/components/catalog/product-card.tsx#L66-L72)
- Problem: `sizes` is correct; no `quality` (default 75 fine). Cloudinary URLs pass through `/_next/image` paying Node CPU.
- Impact: ~5–15 % SSR CPU on busy catalog pages.
- Fix: custom Cloudinary loader in `next.config.mjs` mapping URL → `q_auto,f_auto,w_<w>`. Skip optimisation for `placehold.co`.
- Effort: S

### OPT-022 · L · open · project P2 (catalog)

**`images.remotePatterns` lacks `pathname`.**

- File: [`apps/web/next.config.mjs:15-22`](apps/web/next.config.mjs#L15-L22)
- Problem: permissive — security/perf nit.
- Fix: add `pathname` constraints per host.
- Effort: XS

### OPT-023 · M · open · project P6 (admin)

**Variant create re-fetches all branches.**

- File: [`apps/web/src/app/api/admin/products/[id]/variants/route.ts:54-80`](apps/web/src/app/api/admin/products/[id]/variants/route.ts#L54-L80)
- Problem: `tx.storeBranch.findMany` per variant create. Cheap with 5 branches, scales linearly.
- Fix: reuse cached `getActiveBranches` from OPT-011.
- Effort: XS

### OPT-024 · M · open · project P6 (admin)

**`syncProductColorFromVariants` outside parent transaction.**

- Files: `apps/web/src/app/api/admin/products/[id]/route.ts:117`, `apps/web/src/app/api/admin/products/[id]/variants/route.ts:85`, `[variantId]/route.ts:71,119`
- Problem: variant CRUD commits, then color sync opens its own transaction. Race: stale `attributes.color` between commits. Adds 1–2 round-trips.
- Impact: 20–60 ms per variant CRUD; small race window.
- Fix: pass `tx` into `syncProductColorFromVariants(productId, tx)`; run inline.
- Effort: S

---

### OPT-025 · L · done (2026-05-09) · project P2 (catalog)

**Taxonomy reads (`getActiveCategories/Brands/CategoryTree`) uncached.**

- Resolved via `unstable_cache` wrappers (revalidate 5–10 min, tag `taxonomy`); invalidated from admin category/brand CRUD. See Wave 1 / item (2).

### OPT-026 · L · open · project P2 (catalog)

**`getProductBySlug` over-fetches all locales.**

- File: [`apps/web/src/server/catalog.ts:398-489`](apps/web/src/server/catalog.ts#L398-L489)
- Problem: RU users still receive `descriptionUz` and `descriptionEn` in RSC payload.
- Impact: 2–10 KB extra payload per product page.
- Fix: accept `locale` parameter; `select` only matching `name<Loc>` / `description<Loc>` columns. Keep `*_ru` as fallback (per i18n §4.5 — always fall back on `ru`).
- Effort: M

### OPT-027 · L · open · project P3 (favorites)

**`getFavoritesForUser` uses heavy card select.**

- File: [`apps/web/src/server/catalog.ts:510-534`](apps/web/src/server/catalog.ts#L510-L534)
- Problem: 50 favorites × 10 variants × N stock rows per `/favorites` and per GET.
- Impact: 100–300 ms heavy users; 50–100 KB payload.
- Fix: lean `FAVORITE_CARD_SELECT` (no variants); compute min price via `aggregate` once. Long-term: `Product.minPriceCents` denormalised.
- Effort: M

### OPT-028 · L · done (2026-05-09) · project P2 (catalog)

**`QuickView` and `CardCartControls` shipped eagerly with every card.**

- Resolved: split [`quick-view.tsx`](apps/web/src/components/catalog/quick-view.tsx) into a thin trigger + lazy [`quick-view-dialog.tsx`](apps/web/src/components/catalog/quick-view-dialog.tsx) via `next/dynamic(..., { ssr: false })` with a `hasOpened` latch (modal stays mounted on subsequent close→open). See Wave 2 / item (8).

### OPT-029 · L · open · project P6 (admin)

**Admin `ProductForm` ships full attribute map.**

- File: [`apps/web/src/app/[locale]/admin/products/[id]/page.tsx:44-46`](apps/web/src/app/[locale]/admin/products/[id]/page.tsx#L44-L46)
- Problem: all categories' attribute configs serialised to client. 50 categories × 10 attributes × locale fields.
- Impact: 30–80 KB extra hydration data.
- Fix: send only current category + parent chain. Lazy-load on category change via new `GET /api/admin/categories/[id]/attributes`.
- Effort: M

### OPT-030 · L · open · project P6 (admin) / P4 (payments)

**`bulk-refund` Uniteller calls have no per-attempt timeout.**

- File: [`apps/web/src/app/api/admin/payments/bulk-refund/route.ts:75-101`](apps/web/src/app/api/admin/payments/bulk-refund/route.ts#L75-L101)
- Problem: sequential by design (rate-limit), but one stuck call blocks the rest. Worst-case 25 min for 50 refunds — past edge function caps.
- Fix: move to BullMQ worker; route enqueues + returns `202` with job id. Client polls / SSE. (Aligns with СПЕЦИФИКАЦИЯ §3 — BullMQ already in stack.)
- Effort: M

### OPT-031 · L · deferred · project P5 (order history)

**`account/orders` `_count.items` + `payments: take 1` scales linearly.**

- File: [`apps/web/src/server/account-orders.ts:115-130`](apps/web/src/server/account-orders.ts#L115-L130)
- Impact: 20–60 ms once orders > 100k. Fine today.
- Fix: defer until measured; consider `Order.itemsCount` denormalisation.
- Effort: S

### OPT-032 · L · done (2026-05-09) · project P6 (admin)

**Admin orders `q` ILIKE on `Order.number` + `User.email` without trigram.**

- Resolved transitively via the trigram extension + GIN indexes added in migration `20260509140000_phase1_indexes` (see OPT-003). Both `products.name_*` and `users.email` are now backed by `gin_trgm_ops`.

---

## Section 2 — Rollout (waves)

> "Wave" instead of "Phase" to avoid colliding with СПЕЦИФИКАЦИЯ §8 phases
> `P0`…`P8`. Each wave bundles 3–5 findings that share rollout risk + the
> same regression-test surface.

### Wave 1 — Indexes + cache ✅ done 2026-05-09

_Pure migration + small wrappers, no behaviour change._

- [x] **(1)** Schema migration adding indexes (OPT-008, OPT-014, OPT-003, OPT-032):
  - `payments(orderId, createdAt DESC)`
  - `orders(status, createdAt)`
  - `order_items(variantId, orderId)`
  - `CREATE EXTENSION pg_trgm` + GIN on `products(name_ru, name_uz, name_en)` and `users(email)`
  - Migration: [`20260509140000_phase1_indexes`](packages/db/prisma/migrations/20260509140000_phase1_indexes/migration.sql)
- [x] **(2)** `unstable_cache` wrappers for `getActiveCategories/Brands/CategoryTree/Branches/AllAttributeKeys` (OPT-011, OPT-016, OPT-025). New helper [`server/active-branches.ts`](apps/web/src/server/active-branches.ts); tags `taxonomy` / `branches` / `attributes` invalidated from admin CRUD routes via `revalidateTag`.
- [x] **(3)** Promote `name` / `email` into JWT (OPT-018). Profile page no longer hits Prisma; `useSession().update(...)` keeps the token fresh after edits.
- [x] **(4)** `prisma.paymentLog.createMany` in `bulk-role` and `orders/bulk` (OPT-005). New `writePaymentLogs([...])` helper does one round-trip vs N concurrent inserts.

### Wave 2 — Catalog hot path ✅ done 2026-05-09

_Catalog perceived latency is dominated by the product-card pipeline._

- [x] **(5)** Stream home page sections under `<Suspense>` (OPT-012). [`/[locale]/page.tsx`](apps/web/src/app/[locale]/page.tsx) — categories / featured / brands each in their own `<Suspense>` boundary with shape-matched skeleton fallbacks; hero ships immediately.
- [x] **(6)** Replace `PRODUCT_CARD_SELECT.variants.stock` with `prisma.stock.groupBy` once per page (OPT-006). New helpers `fetchAvailableByVariant` + `buildCardsWithStock` in [`server/catalog.ts`](apps/web/src/server/catalog.ts) — one aggregation query per listing. Affects `getFeaturedProducts`, `getProductsByCategory`, `getSearchSuggestions`, `searchProducts`. Favorites snapshot doesn't need stock — passes `EMPTY_STOCK_MAP`.
- [x] **(7)** Switch `getProductsByCategory` price-sort to SQL pagination (OPT-007). **Verified**: Prisma 5.22 doesn't support `orderBy: { variants: { _min: { priceCents } } }` on `findMany`, but it _does_ support `orderBy: { _min: { priceCents } }` inside `productVariant.groupBy`. Used groupBy with `skip` / `take` to get the page's `productId`s, then a single `findMany({ where: { id: { in } } })` keyed on those — no more "fetch all, slice in JS" hack.
- [x] **(8)** Lazy-load QuickView dialog body via `next/dynamic` (OPT-028). [`quick-view-dialog.tsx`](apps/web/src/components/catalog/quick-view-dialog.tsx) holds the heavy modal tree; [`quick-view.tsx`](apps/web/src/components/catalog/quick-view.tsx) keeps only the trigger button and `dynamic()`-imports the dialog after first click via a `hasOpened` latch.

### Wave 3 — Checkout transaction tightening

_Highest-stakes write path; touch carefully with strong tests._
_Project phase: **P4** (checkout/payments) — гейтит P8-T1._

- [ ] **(9)** Refactor `reserveOrderStock` / `releaseOrderStock` / `commitOrderShipment`: bulk find + parallel updates + `createMany` for logs (OPT-001).
- [ ] **(10)** `daily_order_counters` upsert-returning replaces `nextOrderSequenceForDay` (OPT-009). Requires reversible migration adding a `daily_order_counters(day, counter)` table.
- [ ] **(11)** `tx` parameter into `syncProductColorFromVariants`, run inside parent variant-CRUD TX (OPT-024).
- [ ] **(12)** Promo cache: Redis 60s TTL with admin-CRUD invalidation; standardise lookup to unique-index exact match (OPT-010).

### Wave 4 — Category attributes + admin

_Project phase: **P2** + **P6**._

- [ ] **(13)** Replace `getCategoryAncestorChain` per-level loop with recursive CTE OR use `getCategoryAttributesMap` in hot paths; consider denormalised `Category.path` (OPT-002, OPT-019).
- [ ] **(14)** `bulk-adjust` and `stock/import`: pre-fetch all stocks; one TX with all updates + `stockLog.createMany` (OPT-004).
- [ ] **(15)** Convert dashboard sub-components to sync; hoist `getTranslations` (OPT-013).
- [x] **(16)** Fix dashboard top-products revenue with `$queryRaw` (OPT-015) — landed early as a side-effect of fixing the BigInt mix-types crash on `/admin`.

### Wave 5 — Bundle + payload trimming

_Project phase: **P2** (catalog) + **P6** (admin)._

- [ ] **(17)** `getProductBySlug` / `getProductsByCategory` accept `locale`; select only that locale's columns + `*_ru` fallback (OPT-026).
- [ ] **(18)** Lean `FAVORITE_CARD_SELECT` (OPT-027); add denormalised `Product.minPriceCents`.
- [ ] **(19)** Send only current category's attribute config to admin product form; lazy-load on change (OPT-029).
- [ ] **(20)** Cloudinary loader in `next.config.mjs` (OPT-021); lock `remotePatterns` paths (OPT-022).

### Wave 6 — Operational

_Project phase: **P4** + **P5** + **P8** (observability)._

- [ ] **(21)** Move `bulk-refund` to BullMQ worker with progress polling (OPT-030).
- [ ] **(22)** Reconfirm `Order.findFirst` nested-include duplication on Prisma 5.22 — possibly drop the second refunds round-trip (OPT-017).

---

## Section 3 — Open questions / things to measure first

Pruned to items that are still genuinely unanswered. (Resolved items have been
moved into the corresponding finding's body.)

- [ ] **PG `Order.status` index usage** — `EXPLAIN ANALYZE` for `WHERE status IN (...) AND created_at >= ...` at production size. If planner already picks index-only scan via `orders_created_at_idx`, the composite added in Wave 1 is unnecessary (drop in a follow-up migration).
- [ ] **Prisma 5.22 nested-include duplication** — does `payments → refunds` still duplicate rows under a consistent `select`? Gates OPT-017 / Wave 6 / item (22).
- [ ] **Cold vs warm `/catalog/[slug]`** — measure with no Redis vs with `unstable_cache` wrappers. If 60–80 % of latency is taxonomy + attribute keys + brands, Wave 1 / item (2) already captured the bulk of the win.
- [ ] **Distribution of variants × branches per product** — if median is 1×1, OPT-006 was over-engineering for the current catalog (it's already done; this is a retroactive sanity check, not a blocker).
- [ ] **Price-sort traffic share** — if < 5 %, deferring future optimisations on the price-sort path is fine. (OPT-007 has already landed.)
- [ ] **`getCategoryAttributesMap` materialisation cost** — if taxonomy < 100 categories, this might be cheap enough as the default path, eliminating per-category ancestor walk entirely. Informs OPT-002 fix shape.
- [ ] **`next/image` optimisation CPU bottleneck** — measure `/_next/image` in production. Cheap if not, big win if yes (OPT-021).
- [ ] **`Order.number` prefix scan plan** — verify PG uses index-scan-backward on `(number)` for `LIKE 'BGX-YYYYMMDD-%' ORDER BY number DESC LIMIT 1`. SeqScan = OPT-009 urgent.
- [ ] **Hot RSC payload sizes** — measure `__NEXT_DATA__` / RSC stream wire size on home, catalog, product. < 50 KB compressed = skip OPT-026 / OPT-027.
- [ ] **Worker `checkPendingPayments` connection pool** — at 10+ pending/min, confirm worker uses pooler URL not direct PG connection. (Project P4-T9.)

---

## Section 4 — Revision history

- **2026-05-11** — Plan revised. ID format reworked: `P0-N` / `P1-N` / `P2-N` → `OPT-NNN` (numbering preserved) with `H` / `M` / `L` priority + `Status` + `Project phase` side-labels. Rollout "phases" renamed to "waves" to disambiguate from СПЕЦИФИКАЦИЯ §8 project phases. Verified Wave 1 + Wave 2 done on disk (migration `20260509140000_phase1_indexes`, helpers `fetchAvailableByVariant` / `writePaymentLogs` / `active-branches.ts`, components `quick-view-dialog.tsx`). All completed items dated. Resolved open questions inlined into their finding bodies. OPT-003 / OPT-032 promoted from "queued" to "done" (trigram indexes landed in Wave 1).
- **2026-05-09** — Wave 1 (items 1–4) and Wave 2 (items 5–8) landed. OPT-015 (`P1-15` at the time) landed as a side-effect of the BigInt crash fix on `/admin`.
- Earlier — initial findings drafted (`P0-1` … `P2-32`).

---

## Critical files for implementation

- [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)
- [apps/web/src/server/catalog.ts](apps/web/src/server/catalog.ts)
- [apps/web/src/server/category-attributes.ts](apps/web/src/server/category-attributes.ts)
- [apps/web/src/server/order-stock-movement.ts](apps/web/src/server/order-stock-movement.ts)
- [apps/web/src/server/admin-dashboard.ts](apps/web/src/server/admin-dashboard.ts)
- [apps/web/src/server/orders.ts](apps/web/src/server/orders.ts)
- [apps/web/src/auth/config.ts](apps/web/src/auth/config.ts)
- [apps/web/next.config.mjs](apps/web/next.config.mjs)
