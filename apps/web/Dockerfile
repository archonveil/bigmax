# =====================================================================
# Бигмах web — production Next.js 14 build.
#
# Stages:
#   1. base    — node + libssl3/openssl + corepack + pnpm. Все остальные
#                stage'и FROM base, чтобы libssl был во всех (runner, migrate
#                через target: builder, etc.).
#   2. deps    — pnpm install workspace-aware (frozen lockfile, HUSKY=0).
#   3. builder — prisma generate + next build (full type-check + i18n parity).
#   4. runner  — final image, non-root user, `node next start`.
#
# bookworm-slim для sharp+AVIF prebuilt'ов. Image ~400MB после standalone-fail.
# =====================================================================

# ===== Stage 1: base =====
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

# Prisma binary engine на bookworm требует libssl3 + openssl runtime'а.
# Без него `Schema engine error` (engine не может прочесть DB-протокол).
# ca-certificates — для https-calls (Uniteller, Telegram API).
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app


# ===== Stage 2: deps =====
FROM base AS deps

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

# БЕЗ `--ignore-scripts` чтобы prisma postinstall set up'ил .bin/prisma.
# HUSKY=0 уже от base — husky prepare не пытается ставить git-hooks.
RUN pnpm install --frozen-lockfile


# ===== Stage 3: builder =====
FROM base AS builder

# NEXT_PUBLIC_* vars are baked into the bundle at build time — pass them as
# ARGs so `next build` can inline them. Runtime env_file is too late.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

# Полная среда из deps (включая весь pnpm-граф + установленные linkers).
COPY --from=deps /app /app
# Source files. Не перекрывают `/app/node_modules` — в host context node_modules excluded.
COPY . .

# Prisma client + binary engines.
RUN pnpm --filter @bigmax/db exec prisma generate --schema=prisma/schema.prisma

# i18n parity check — safety-net перед build'ом.
RUN pnpm tsx scripts/check-translation-keys.ts

WORKDIR /app/apps/web
RUN pnpm build


# ===== Stage 4: runner =====
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user с writable home (-m) — иначе corepack/pnpm пытается mkdir
# в `/home/nextjs/.cache/` и падает с EACCES.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs -m -d /home/nextjs nextjs

# Copy entire built app + node_modules. Reliable prisma resolution.
COPY --from=builder --chown=nextjs:nodejs /app /app

# Uploads-dir — здесь docker-compose маунтит persistent volume.
RUN mkdir -p /app/apps/web/public/uploads/products \
 && chown -R nextjs:nodejs /app/apps/web/public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

WORKDIR /app/apps/web
# Прямо node без pnpm — избегаем corepack-download'ы на каждом restart'е.
# В pnpm workspace next живёт в /app/apps/web/node_modules/.bin/next (symlink
# на /app/node_modules/.pnpm/next@14.X/node_modules/next/dist/bin/next).
CMD ["node", "./node_modules/next/dist/bin/next", "start"]
