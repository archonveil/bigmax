# =====================================================================
# Бигмах web — production Next.js 14 standalone build.
#
# Multi-stage:
#   1. deps    — pnpm install (workspace-aware, frozen lockfile).
#   2. builder — prisma generate + next build (output: 'standalone').
#   3. runner  — минимальный node-runtime с standalone output + sharp.
#
# Sharp + AVIF: используем bookworm-slim вместо alpine — gwarantирует
# libvips + libavif prebuilt без extra setup'а (на alpine AVIF иногда
# требует пересборки нативных модулей). +30Mb image size, но reliable.
# =====================================================================

# ===== Stage 1: deps =====
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Копируем все package.json'ы workspace'а — pnpm должен resolve'ить весь граф.
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

RUN pnpm install --frozen-lockfile --ignore-scripts


# ===== Stage 2: builder =====
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
# Workspace symlink'ы хранятся в .pnpm/ — копируем целиком.
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .

# Prisma client — обязательная пре-сборка перед next build (catalog.ts +
# admin-products.ts читают `@bigmax/db` который re-export'ит client).
WORKDIR /app/packages/db
RUN pnpm exec prisma generate --schema=prisma/schema.prisma

WORKDIR /app/apps/web

# i18n parity check как safety-net — деплоить с unbalanced locale нельзя.
RUN cd /app && pnpm tsx scripts/check-translation-keys.ts

# Next build с `output: 'standalone'` собирает minimal-зависимости в
# `.next/standalone/`, готовые к copy в runner stage без node_modules.
RUN pnpm build


# ===== Stage 3: runner =====
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Non-root user — security best practice для serve'я production traffic.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output: `server.js` + минимальные node_modules + .next/
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Prisma engines + schema нужны для `prisma migrate deploy` (мы запускаем
# его как одноразовый command перед start'ом web-сервиса в docker-compose).
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma ./packages/db/prisma
# Prisma client binary engine.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client* ./node_modules/.pnpm/
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/prisma* ./node_modules/.pnpm/

# Uploads-dir — здесь docker-compose маунтит persistent volume.
RUN mkdir -p /app/apps/web/public/uploads/products \
 && chown -R nextjs:nodejs /app/apps/web/public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Standalone-output генерирует apps/web/server.js — entry-point. Внутри
# next.config.mjs наш `output: 'standalone'` (см. конфиг).
CMD ["node", "apps/web/server.js"]
