# =====================================================================
# Бигмах web — production Next.js 14 build.
#
# Multi-stage:
#   1. deps    — pnpm install (workspace-aware, frozen lockfile).
#   2. builder — prisma generate + next build (full type-check + i18n parity).
#   3. runner  — копируем целиком собранное app + node_modules.
#
# Размер runner-образа ~400MB. Standalone-output (`output: 'standalone'` в
# next.config.mjs) трассирует JS-deps, но не справляется с Prisma'ы
# generated-client + binary engines в pnpm-workspace layout'е. Pragmatic
# trade-off: чуть больше image vs reliable Prisma resolution.
#
# Sharp + AVIF: bookworm-slim — гарантирует libvips+libavif prebuilt без
# extra setup'а. +30Mb image size vs alpine, но reliable AVIF encoding.
# =====================================================================

# ===== Stage 1: deps =====
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
# HUSKY=0 — husky's `prepare` script пытается установить git-hooks в /app/.git/,
# которого нет в Docker'е → fail. Этот env-flag заставляет husky no-op'ить.
# Альтернатива --ignore-scripts ломала prisma's postinstall (`.bin/prisma`).
ENV HUSKY=0
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace package.json'ы — pnpm должен resolve'ить весь dep-граф.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/payments/package.json packages/payments/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/notifications/package.json packages/notifications/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/

# `--frozen-lockfile` для repeatable builds. БЕЗ `--ignore-scripts` чтобы
# prisma postinstall set up'ил .bin/prisma корректно.
RUN pnpm install --frozen-lockfile


# ===== Stage 2: builder =====
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Полная среда из deps stage (включая весь pnpm-граф + установленные linkers).
COPY --from=deps /app /app
# Source files (workspace-packages + apps + scripts + configs). Не перекрывают
# `/app/node_modules` потому что в host'ном context'е node_modules excluded.
COPY . .

# Prisma client + binary engines — нужны до next build (catalog.ts читает
# `@bigmax/db` который re-export'ит client).
RUN pnpm --filter @bigmax/db exec prisma generate --schema=packages/db/prisma/schema.prisma

# i18n parity check — safety-net перед build'ом.
WORKDIR /app
RUN pnpm tsx scripts/check-translation-keys.ts

WORKDIR /app/apps/web
RUN pnpm build


# ===== Stage 3: runner =====
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Non-root user — security best practice.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Copy entire built app + node_modules. Pragmatic — reliable prisma resolution.
COPY --from=builder --chown=nextjs:nodejs /app /app

# Uploads-dir — здесь docker-compose маунтит persistent volume.
RUN mkdir -p /app/apps/web/public/uploads/products \
 && chown -R nextjs:nodejs /app/apps/web/public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start"]
