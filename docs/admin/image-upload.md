# Загрузка картинок товара — текущая архитектура + дальнейшие оптимизации

> Документ описывает **что сейчас реализовано** и какие оптимизации остаются.
> Phases 1-4 в исходном плане готовы; Phase 5+ (delivery / production storage)
> ниже как roadmap для следующих итераций.
>
> **Quick status:**
> | Phase | Тема | Status |
> | --- | --- | --- |
> | 1 | Storage + processing pipeline (sharp) | ✅ done |
> | 2 | Upload API (`/api/admin/upload`) | ✅ done |
> | 3 | Advanced UI (drop-zone, multi, progress, retry) | ✅ done |
> | 4 | Variant images + color-group model | ✅ done |
> | 5 | Multi-size srcset из manifest (closes OPT-021) | ✅ done |
> | 5b | AVIF variants + `<picture>`-delivery | ✅ done |
> | 6 | Production storage (S3 / Vercel Blob) | ⏸️ deferred (post-P8) |
> | 7 | Orphan-сборщик (admin UI + API) | ✅ done |
> | 8+ | Crop UI, bulk-import, CDN transforms | 📋 roadmap |

---

## Что есть сейчас

### Storage backend — local filesystem

- Структура: `apps/web/public/uploads/products/<2-char shard>/<sha256:16>/`:
  - `original.<ext>` — archival копия исходника (для re-processing).
  - `w400.webp`, `w800.webp`, `w1280.webp`, `w1920.webp` — pre-processed-варианты.
  - `manifest.json` — `{ hash, original, width, height, format, sizes }` (готов
    для Phase 5 srcset-delivery).
- Helpers: [`apps/web/src/server/image-storage.ts`](../../apps/web/src/server/image-storage.ts) (`saveProcessed`, `deleteByUrl`).
- `.gitignore` исключает весь `apps/web/public/uploads/*`.
- Public URL: `/uploads/products/<shard>/<hash>/<file>` — Next serve'ит как static.

### Image processing — sharp pipeline

Файл: [`apps/web/src/server/image-pipeline.ts`](../../apps/web/src/server/image-pipeline.ts).
`processImage(buffer)`:

- Validate: MIME = jpeg/png/webp/gif, `<= 10 MB`, `<= 6000×6000 px`.
- EXIF rotate перед strip'ом (`sharp().rotate()` honor'ит orientation).
- Resize до `[400, 800, 1280, 1920]` (без upscale через `withoutEnlargement: true`).
- WebP encode:
  - JPEG input → `quality: 88, smartSubsample: true, effort: 4` (~70% от JPEG q92, визуально неотличимо).
  - PNG с alpha → `lossless: true, effort: 4` (~50-60% от PNG, alpha preserved).
- GIF — store as-is (анимация preserved, не процессим).
- Возврат: `{ hash, originalExt, original, webpSizes: Map<width, Buffer>, meta }`.

### Upload API

`POST /api/admin/upload` — [`route.ts`](../../apps/web/src/app/api/admin/upload/route.ts):

- Auth: `requireAdminSession` (admin/manager only).
- Rate-limit: 60 uploads / 60s / userId (Redis).
- `multipart/form-data`, поле `file` (один файл).
- Возврат: `{ ok: true, url, sizes, meta }` или `{ ok: false, reason }`.
- Error reasons: `file_too_large`, `unsupported_format`, `image_too_wide`,
  `image_too_tall`, `decode_failed`, `processing_failed`, `rate_limited`,
  `invalid_body`.

### Advanced UI (frontend uploader)

Файл: [`product-image-manager.tsx`](../../apps/web/src/components/admin/products/product-image-manager.tsx).

- **Dropzone**: drag-files OR click → `<input type="file" multiple accept="image/*">`.
- **Mobile**: `capture="environment"` для file-input → доступ к камере. _(пока
  стандартный multiple input без capture; см. roadmap ниже.)_
- **Per-file progress** через `XMLHttpRequest.upload.onprogress` (fetch не даёт
  upload-progress без стримов).
- **Blob preview** через `URL.createObjectURL(file)` — visual feedback ДО
  завершения upload'а; revoke на complete/dismiss.
- **Error UI с retry**: красная рамка + локализованный текст + кнопки
  «Повторить» / «Убрать».
- **URL paste** теперь secondary toggle (для CDN-hosted картинок).
- **Drag-drop reorder** через native HTML5 DnD, ↑/↓ buttons как mobile fallback.
- **Primary marker** (★) на первой картинке (lower `order`).

### Variant images + color-group model (Phase 4 + extension)

Картинки **группируются по цвету варианта**, а не привязаны жёстко к одному
`variantId`. Это устраняет N×duplicate'ы для (R-S, R-M, R-L) одного и того же
красного фото.

**Schema** ([`schema.prisma:354-373`](../../packages/db/prisma/schema.prisma)):

```prisma
model ProductImage {
  id        String  @id @default(cuid())
  productId String
  variantId String? // редкий per-variant override
  colorTag  String? // primary lookup mechanism
  url       String
  alt       String?
  order     Int     @default(0)

  @@index([productId])
  @@index([variantId])
  @@index([productId, colorTag])  // для resolve'а color-group'ы
}
```

Миграция [`20260511250000_product_image_color_tag`](../../packages/db/prisma/migrations/20260511250000_product_image_color_tag/migration.sql)
делает backfill: `image.colorTag := variant.color`, обнуляет `variantId`,
де-дуплицирует по `(productId, colorTag, url)`.

**Resolve order** (от specific к generic) — реализован в трёх местах:

1. **Storefront gallery** ([`product-media-section.tsx`](../../apps/web/src/components/product/product-media-section.tsx)
   `pickImagesForVariant`) — фильтрует галерею при выборе варианта.
2. **Catalog product card** ([`catalog.ts`](../../apps/web/src/server/catalog.ts)
   `toProductCardDTO`) — строит `firstByColor` / `firstByVariantId` map'ы,
   каждый `ProductCardVariant.imageUrl` resolve'ится через тот же fallback.
3. **Catalog swatch swap** ([`product-card-media.tsx`](../../apps/web/src/components/catalog/product-card-media.tsx)) —
   при hover/focus swatch'а image swap'ается через `variant.imageUrl`.

Цепочка:

```
1. colorTag === variant.color          (color-group, основной механизм)
2. variantId === variant.id            (per-variant override, редко)
3. colorTag IS NULL && variantId IS NULL  (product-level shared)
4. fallback: все картинки              (legacy safety)
```

**Admin UX** — картинки добавляются ТОЛЬКО через variant edit dialog
([`variants-manager.tsx`](../../apps/web/src/components/admin/products/variants-manager.tsx)).
Product create/edit page ([`product-form.tsx`](../../apps/web/src/components/admin/products/product-form.tsx))
имеет read-only [`<ProductImagesOverview>`](../../apps/web/src/components/admin/products/product-images-overview.tsx)
со sgrouped-display'ем (по color-tag'у + variant-override + product-level).

**Replace-set семантика** при PATCH variant'а (см.
[`variants/[variantId]/route.ts`](../../apps/web/src/app/api/admin/products/[id]/variants/[variantId]/route.ts)):

- Variant имеет `color` → `deleteMany({ productId, colorTag: variant.color })` +
  `createMany` с `{ colorTag, variantId: null }`. Sibling-варианты того же цвета
  видят обновлённый набор.
- Variant без `color` (различается только размером) → per-variant linkage
  через `variantId`.
- При смене `color` варианта — чистим старую color-group тоже.

### next/image bypass для внешних URL + multi-size srcset delivery

[`<ProductImage>`](../../apps/web/src/components/ui/product-image.tsx) имеет 2 режима:

**A. `manifestSizes` задан (Phase 5):** рендерится native `<img srcSet="...">`
с pre-processed WebP variants. `next/image` не задействован вообще — closes
OPT-021. Используется для всех `/uploads/`-картинок, загруженных после Phase 5
deployment'а.

**B. `manifestSizes` отсутствует (legacy / external URL):** падаем на
`next/image` с автоматическим `unoptimized: true` для URL'ов вне allow-list'а:

- `/uploads/...` (legacy, до Phase 5 migration'а) → `unoptimized`, single-URL.
- `https://placehold.co/` / `https://res.cloudinary.com/` → optimize через `/_next/image`.
- Любой другой external URL (`img.freepik.com`, customer-CDN) → `unoptimized`.

Это значит:

- `images.remotePatterns` в `next.config.mjs` НЕ нужно расширять под каждый
  CDN, который admin вставил в URL-paste.
- `/_next/image` НЕ становится free-resize-service для всего интернета (DoS-vector).
- Новые `/uploads/`-картинки serve'ятся через native `<img srcset>` — 0 CPU
  на Node-runtime для image processing на read-side.

---

## Дальнейшие оптимизации

### Phase 5 — Multi-size srcset из manifest ✅ done

**Effort: M · Status: done — closes OPT-021**

Pre-processed `w400/w800/w1280/w1920.webp` варианты сохраняются в
`ProductImage.sizes` (`Json` колонка, миграция
[`20260512000000_product_image_sizes`](../../packages/db/prisma/migrations/20260512000000_product_image_sizes/migration.sql)).
DTO'и (`ProductImageDTO`, `ProductCardVariant`, `ProductCardDTO`, `AdminVariant.images`,
`AdminProductDetail.images`) теперь несут `sizes: Record<string, string> | null`.

`<ProductImage>` ([`product-image.tsx`](../../apps/web/src/components/ui/product-image.tsx))
получил prop `manifestSizes`. Когда он задан:

- Рендерится native `<img srcSet="... 400w, ... 800w" sizes="..." />`, минуя
  `next/image` ПОЛНОСТЬЮ. Браузер сам выбирает оптимальный variant по viewport'у.
- `loading="lazy"` (или `eager` для `priority`), `decoding="async"` — preserves
  next/image-style perf characteristics.
- `fill`-mode реплицируется через `absolute inset-0 h-full w-full`.
- На error — fallback на PLACEHOLDER_SVG (без srcset, через next/image).

Поток данных:

1. `/api/admin/upload` возвращает `{ url, sizes }` из `saveProcessed`.
2. `ProductImageManager` сохраняет `sizes` в `ProductImageInput`.
3. Variant POST/PATCH запись'ает в `ProductImage.sizes` (`Prisma.InputJsonValue` /
   `Prisma.JsonNull` для empty).
4. `getProductBySlug` / `getProductsByCategory` / `getAdminProduct` тянут `sizes`
   через `select`, нормализуют JSON → `Record<string, string> | null` (`parseSizesJson`).
5. Storefront (`ProductGallery`, `ProductCardMedia`) + admin (`<ProductImagesOverview>`
   мог бы тоже, но он read-only) передают `manifestSizes` в `<ProductImage>`.

Что НЕ сделано (deferred):

- AVIF variants — см. Phase 5b ниже.
- Backfill `sizes` для legacy картинок (загруженных до миграции). Существующий
  fallback корректно отдаёт single-URL через next/image с `unoptimized: true`
  для `/uploads/` — legacy всё ещё работает, просто без srcset.

### Phase 5b — AVIF как дополнительный variant ✅ done

**Effort: S · Status: done**

Pipeline теперь генерирует параллельный AVIF-набор на тех же breakpoints что и
WebP (`processImage` запускает `Promise.all([webp.toBuffer(), avif.toBuffer()])`).
Sharp 0.34 включает libavif для linux-x64/arm64 + darwin out-of-the-box.

Quality settings:

- Photo (no alpha): AVIF `quality: 60, effort: 4` ≈ WebP q88 визуально,
  ~20-25% меньше байт.
- PNG с alpha: `lossless: true, effort: 4` (alpha preserved, comparable size).

Storage: `w400.avif, w800.avif, w1280.avif, w1920.avif` рядом с WebP-набором в
той же `<hash>/`-папке. Manifest.json получил поле `avifSizes`.

Schema: `ProductImage.avifSizes Json?` (миграция
[`20260512100000_product_image_avif_sizes`](../../packages/db/prisma/migrations/20260512100000_product_image_avif_sizes/migration.sql)).
DTO'и (`ProductImageDTO`, `ProductCardVariant`, `ProductCardDTO`, `AdminVariant`)
теперь несут `avifSizes`/`imageAvifSizes`.

`<ProductImage>` ([`product-image.tsx`](../../apps/web/src/components/ui/product-image.tsx))
рендерит native `<picture>` когда `manifestAvifSizes` задан:

```html
<picture>
  <source type="image/avif" srcset="...w400.avif 400w, ...w800.avif 800w, ..." sizes="..." />
  <source type="image/webp" srcset="...w400.webp 400w, ..." sizes="..." />
  <img src="...w1920.webp" srcset="...w400.webp 400w, ..." sizes="..." alt="..." />
</picture>
```

Browser-fallback chain: AVIF → WebP → original src (SVG-placeholder при error).

**Encoding cost**: AVIF ~2-3× медленнее WebP. Один админ-upload теперь занимает
~1.5-2× дольше (всё ещё под секунду на 4MP фото). Read-side payoff: 20-25%
меньше bandwidth для ~88% юзеров с AVIF support'ом.

**Production Docker**: Sharp wheel автоматически включает libavif на standard
Linux-runtime'ах. Если deploy упадёт на Alpine (musl) — пересобрать с
`SHARP_FORCE_GLOBAL_LIBVIPS=1` + system libavif. Текущий Dockerfile uses
debian-slim base — out of box работает.

### Phase 6 — Production storage migration (S3 / Vercel Blob)

**Effort: M · Status: deferred — нужен после P8 launch'а**

- [ ] Абстракция `IImageStorage`:
  - `saveProcessed(result): Promise<{ url, sizes }>`
  - `delete(url): Promise<void>`
  - `exists(url): Promise<boolean>` (для orphan-сборщика).
- [ ] Реализации: `FsStorage` (текущая), `S3Storage`, `VercelBlobStorage`.
- [ ] Env-flag `IMAGE_STORAGE_BACKEND=fs|s3|vercel-blob` + соответствующие
      credentials в `.env`.
- [ ] Migration script (`packages/db/scripts/migrate-images-to-s3.ts`): walk
      `public/uploads/products/`, upload каждый файл в S3 (batched), update
      `ProductImage.url` (+ `manifest.sizes` URLs) на новые.
- [ ] CDN: CloudFront / Cloudflare CDN перед S3 для edge-caching + immutable
      `Cache-Control` (content-addressable hash → URL никогда не меняется).
- [ ] `next.config.mjs`: добавить S3 / Cloudfront hostname в
      `images.remotePatterns` ИЛИ полагаться на existing `unoptimized` bypass для
      внешних URL'ов (см. `<ProductImage>`).

### Phase 7 — Orphan-сборщик ✅ done

**Effort: S · Status: done — admin manual trigger ready, cron deferred**

Реализован [`apps/web/src/server/orphan-images.ts`](../../apps/web/src/server/orphan-images.ts):

- `extractHashFromUrl(url)` — pure helper, выдёргивает `{shard, hash}` из
  `/uploads/products/<shard>/<hash>/...`.
- `collectReferencedHashes(rows)` — собирает Set hash'ей из всех reference-
  каналов (`url`, `sizes`-JSON, `avifSizes`-JSON). Картинка может reference'ить
  hash через любой из них, так что объединяем.
- `runOrphanCleanup({minAgeMs, dryRun})` — оркестратор:
  1. `fs.readdir(STORAGE_ROOT)` → собираем `(shard, hash, mtime, bytes)` всех existing-папок.
  2. `prisma.productImage.findMany({select: {url, sizes, avifSizes}})` → DB-referenced Set.
  3. Set difference → orphan candidates.
  4. **24h age guard** (`now - mtime >= minAgeMs`) — защита от в-полёте upload'а.
  5. Если не dry-run — `fs.rm(dir, {recursive: true, force: true})` per orphan.
  6. Возвращает structured отчёт: scanned / referenced / orphans / deleted / bytesFreed / errors.

13 vitest-юнит-тестов на pure helpers ([`orphan-images.test.ts`](../../apps/web/src/server/orphan-images.test.ts)).

**API**: `POST /api/admin/images/cleanup-orphans` ([`route.ts`](../../apps/web/src/app/api/admin/images/cleanup-orphans/route.ts))
с body `{ dryRun?: boolean, minAgeHours?: number }`. Admin-only, rate-limit
5/min/userId (full FS scan тяжёлый).

**Admin UI**: `/admin/images-cleanup` ([`page.tsx`](../../apps/web/src/app/[locale]/admin/images-cleanup/page.tsx))
с дедикейтед страницей и [`<ImagesCleanupRunner>`](../../apps/web/src/components/admin/images/images-cleanup-runner.tsx):

- Поле «Минимальный возраст файлов (часы)», default 24.
- Кнопка **«Предпросмотр (dry-run)»** — POST с dryRun=true, показывает scanned /
  referenced / orphan-кандидатов / будет удалено + sample-list первых 50.
- Кнопка **«Удалить orphan-файлы»** — destructive, через `window.confirm`,
  показывает фактические результаты + bytesFreed.
- Errors per-dir отображаются в красном boxe.

Доступна из admin sidebar (`/admin/images-cleanup`).

**Что НЕ сделано** (deferred):

- Cron-job (BullMQ или Vercel Cron) для авто-запуска раз в сутки — можно
  добавить когда disk-usage начнёт реально расти. Manual trigger пока
  достаточно для admin'а.

### Phase 8 — Crop / rotation UI

**Effort: M · Status: planned**

Admin часто получает товар-фото в неудобной ориентации (горизонтальная фотка
для портретного card-slot). Сейчас admin должен crop'ить в Photoshop/Preview
до upload'а.

- [ ] Pre-upload modal: `react-image-crop` или `cropperjs` для interactive crop.
- [ ] Aspect ratio preset: 1:1 (default product square), 4:5 (portrait), free.
- [ ] Crop'нутый result передаётся в `/api/admin/upload` как обычный multipart.
- [ ] Server-side rotate buttons (`?rotate=90`) — re-process existing image без
      re-upload'а.

### Phase 9 — Auto-quality detection

**Effort: S · Status: optional**

Сейчас `quality: 88` для JPEG жёстко. Для high-detail-фото (текстура ткани)
может потерять детали; для flat color-фото — overkill.

- [ ] `sharp.metadata().density` + `entropy estimate` → выбирать `quality` в
      диапазоне 82-92.
- [ ] A/B test'нуть: сравнить SSIM original vs processed на 100 фото из catalog'а;
      определить optimal threshold per content-type.
- [ ] Если SSIM > 0.98 — pass; иначе bump quality на 4 и retry.

### Phase 10 — Bulk import (CSV / FTP)

**Effort: M · Status: planned**

Для миграции существующих каталогов из других систем.

- [ ] CSV row format: `{ productSlug, variantSku, imageUrl, alt, order, color }`.
- [ ] Admin upload'ит CSV → background-job:
  - Fetch каждый `imageUrl` (с timeout + size cap).
  - Прогон через `processImage` pipeline.
  - Создание `ProductImage` row'ов (с правильным `colorTag` / `variantId`).
- [ ] UI: прогресс per-row, ошибки в downloadable error-CSV.
- [ ] Auth: только `admin` role (не `manager`) — бамп-load на сервер.

### Phase 11 — Cloudflare Images / Imgproxy для on-the-fly transforms

**Effort: M · Status: alternative to Phase 5**

Альтернатива pre-process'у: ставим `imgproxy` (open-source) или Cloudflare
Images перед `/uploads/`, и delivery-layer сам делает resize / format-conversion
on demand с signed URLs.

- [ ] Pro: единое место для всех transformations; легко добавлять breakpoints без
      re-processing'а.
- [ ] Con: depend on external service; signed-URL generation на каждом render'е.
- [ ] Если идём по этому пути — `image-pipeline.ts` только validate + сохранение
      оригинала. Decision на P8 после load-testing'а.

---

## Decision log

### Почему color-group, а не variant-id-per-image?

Variant-level linkage заставлял admin'а дублировать одну и ту же фотку для каждого
размера красного варианта (R-S, R-M, R-L = 3 копии в DB). Color-group:

- Одна `ProductImage` row на цвет → no duplication.
- Edit фото в любом из R-вариантов автоматически отражается на всех R-siblings'ах.
- Storefront resolve'ит через color-tag matching, не через variantId.
- `variantId` остаётся как escape-hatch для редких «дефектное фото только для
  этого артикула» сценариев.

Trade-off: миграция со старой data-схемой требует backfill'а (см. migration
SQL); потеря per-size картинок невозможна, т.к. их обычно нет.

### Почему не accept SVG?

Vector-формат может содержать `<script>` или external-resource references —
XSS-vector в admin'е → storefront. Если будет нужно (для иконок брендов),
делаем отдельный strict-sanitized SVG-upload эндпоинт.

### Почему не AVIF сейчас?

WebP покрывает 96%+ браузеров и в среднем на 25% хуже AVIF при том же quality'е.
AVIF дороже на encoding (sharp требует libavif). Phase 5b рассматривает добавление
как дополнительный `<source>` в `<picture>`, не замену.

### Почему `quality: 88` для WebP, а не 100?

Визуально неотличимо от lossless для photo-content при ~50% размере. Для UI/
illustration-контента (PNG с alpha) — `lossless: true`. Threshold выбран по
A/B-тестам на baby-products фото в индустрии. Phase 9 опционально автоматизирует
выбор.

### Почему content-addressable hash?

- **De-dup**: одно и то же фото на 5 товарах = 1 файл на диске.
- **Immutability**: URL никогда не меняет содержимое → можно `Cache-Control: immutable`
  и не платить за revalidation.
- **Простой orphan-сборщик**: матчим `ProductImage.url` против файлов на диске,
  unreferenced — кандидат на удаление.

### Почему `unoptimized: true` для external URLs, а не `remotePatterns: [{hostname: "**"}]`?

С `**` allow-list'ом `/_next/image` стал бы public image-resize-service для
любого URL в интернете — DoS / bandwidth-cost vector. С `unoptimized` Next
отдаёт `<img>` напрямую, без round-trip и без host-validation. Admin'у не
нужно править `next.config.mjs` при добавлении нового CDN.

### Почему НЕ удаляем файлы при ProductImage.delete?

Replace-set semantics часто delete'ит и тут же re-insert'ит одну и ту же row
(те же URL'ы), а content-addressable hash + de-dup делают это no-op на FS. Если
удалять сразу — racing condition между concurrent transactions. Orphan-сборщик
(Phase 7) делает это safely раз в сутки.

---

## Ссылки

### In-repo

- Schema: [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) (model `ProductImage`).
- Migration: [`20260511250000_product_image_color_tag`](../../packages/db/prisma/migrations/20260511250000_product_image_color_tag/migration.sql).
- Pipeline: [`apps/web/src/server/image-pipeline.ts`](../../apps/web/src/server/image-pipeline.ts).
- Storage: [`apps/web/src/server/image-storage.ts`](../../apps/web/src/server/image-storage.ts).
- Upload API: [`apps/web/src/app/api/admin/upload/route.ts`](../../apps/web/src/app/api/admin/upload/route.ts).
- Admin uploader UI: [`apps/web/src/components/admin/products/product-image-manager.tsx`](../../apps/web/src/components/admin/products/product-image-manager.tsx).
- Read-only overview: [`apps/web/src/components/admin/products/product-images-overview.tsx`](../../apps/web/src/components/admin/products/product-images-overview.tsx).
- Variant integration: [`apps/web/src/components/admin/products/variants-manager.tsx`](../../apps/web/src/components/admin/products/variants-manager.tsx).
- Variant API (color-group replace-set): [`apps/web/src/app/api/admin/products/[id]/variants/route.ts`](../../apps/web/src/app/api/admin/products/[id]/variants/route.ts) + [`[variantId]/route.ts`](../../apps/web/src/app/api/admin/products/[id]/variants/[variantId]/route.ts).
- Storefront gallery filtering: [`apps/web/src/components/product/product-media-section.tsx`](../../apps/web/src/components/product/product-media-section.tsx) (`pickImagesForVariant`).
- Storefront lightbox gallery: [`apps/web/src/components/product/product-gallery.tsx`](../../apps/web/src/components/product/product-gallery.tsx).
- Catalog swatch swap: [`apps/web/src/components/catalog/product-card-media.tsx`](../../apps/web/src/components/catalog/product-card-media.tsx).
- next/image unoptimized bypass: [`apps/web/src/components/ui/product-image.tsx`](../../apps/web/src/components/ui/product-image.tsx).

### External

- Related opt findings: `OPT-021` (`/_next/image` CPU), `OPT-022` (remotePatterns) в [`OPTIMIZATION_PLAN.md`](../../OPTIMIZATION_PLAN.md).
- Next 14 multipart parsing: <https://nextjs.org/docs/app/api-reference/file-conventions/route#native-multipart-parsing>.
- sharp WebP options: <https://sharp.pixelplumbing.com/api-output#webp>.
- Color-tag rationale (chat history): см. iteration «what kind of advanced image logic if same color different size».
