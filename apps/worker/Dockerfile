# =====================================================================
# Bigmax worker — BullMQ jobs (P4-T9 pull-проверка платежей; P4-T10
# notifications-job появится позже).
#
# Multi-stage:
#   1. deps    — устанавливаем pnpm-deps по lockfile (workspace-aware).
#   2. runner  — копируем deps + sources, запускаем через tsx.
#
# Запускается в `docker-compose.yml` как сервис `worker`. Зависит от
# postgres + redis.
# =====================================================================

FROM node:22-alpine AS deps

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace-файлы для pnpm install с правильными package.json'ами всех
# workspace-проектов (нужны на этапе resolve'а).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/payments/package.json packages/payments/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/notifications/package.json packages/notifications/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/

# `--frozen-lockfile` гарантирует repeatable build'ы. Игнорируем postinstall
# скрипты husky etc — в контейнере хуки git'а не нужны.
RUN pnpm install --frozen-lockfile --ignore-scripts


# ---------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV PNPM_HOME=/usr/local/pnpm-home
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Копируем node_modules из deps-стейджа (uniform) + исходники.
COPY --from=deps /app /app
COPY apps/worker /app/apps/worker
COPY packages /app/packages

# Prisma client должен быть сгенерирован для текущей платформы (alpine
# отличается по `linux-musl-openssl-3.0.x` от хостовой macOS).
WORKDIR /app/packages/db
RUN pnpm exec prisma generate --schema=prisma/schema.prisma

WORKDIR /app/apps/worker

# tsx стримит TypeScript напрямую — для worker'а сборка `tsc` избыточна.
# В prod можно перейти на `tsc --build` + `node dist/index.js`, но это
# отложим до P8-T1 (нагрузочное тестирование, профайлинг startup-time).
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
