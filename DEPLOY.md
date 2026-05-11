# Production deployment runbook

Stack: Docker Compose · Postgres 16 · Redis 7 · Next.js 14 standalone · BullMQ
worker · Caddy 2 (auto-TLS).

Target: `root@89.126.211.117` · domain `domtextile.uz`.

---

## Первоначальный deploy

### 1. DNS — обязательно ДО запуска Caddy

A-запись для `domtextile.uz` (и `www.domtextile.uz`) → `89.126.211.117`.

Проверка:

```bash
dig +short domtextile.uz @8.8.8.8
# должно вернуть 89.126.211.117
```

Без DNS Caddy не получит Let's Encrypt сертификат. До настройки DNS можно
крутить stack — Caddy retry'ит ACME каждые ~5 минут, как только DNS встанет
— подтянет TLS автоматически.

### 2. Сервер: установка Docker

```bash
ssh root@89.126.211.117
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

### 3. Сервер: клонирование репо

```bash
cd /opt
git clone https://github.com/archonveil/bigmax.git
cd bigmax
```

### 4. Сервер: создание `.env.prod`

Скопируй template и заполни секреты:

```bash
cp .env.prod.example .env.prod
# Generate strong random secrets:
openssl rand -base64 32  # для POSTGRES_PASSWORD
openssl rand -base64 32  # для NEXTAUTH_SECRET / AUTH_SECRET
nano .env.prod
```

Обязательные значения для prod:

- `POSTGRES_PASSWORD` — strong random
- `NEXTAUTH_SECRET` / `AUTH_SECRET` — strong random
- `UNITELLER_*` — production credentials (или `UNITELLER_MODE=mock` для
  smoke-test'а без real payments)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` — для OTP + admin notify
- `ACME_EMAIL` — твой email для Let's Encrypt notify'ев

### 5. Build + запуск stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Первый build занимает ~5-10 минут (pnpm install + next build + sharp).

`migrate` service запустится первым, прогонит `prisma migrate deploy`,
выйдет с exit 0. `web` стартует после успешной миграции.

### 6. Проверка

```bash
# Логи последних 100 строк всех сервисов:
docker compose -f docker-compose.prod.yml logs --tail=100

# Web health (внутри docker-сети):
docker compose -f docker-compose.prod.yml exec web wget -qO- http://localhost:3000/api/health || echo "no /api/health route — use /ru/"

# Снаружи (через Caddy):
curl -I http://domtextile.uz   # 301 → HTTPS
curl -I https://domtextile.uz  # 200 OK
```

### 7. Создание первого admin'а

После запуска БД будет пустой. Создай admin-юзера через seed-script:

```bash
docker compose -f docker-compose.prod.yml exec web node -e "
  const { prisma } = require('@bigmax/db');
  const bcrypt = require('bcryptjs');
  (async () => {
    await prisma.user.upsert({
      where: { email: 'admin@domtextile.uz' },
      update: {},
      create: {
        email: 'admin@domtextile.uz',
        passwordHash: await bcrypt.hash('CHANGE_THIS_PASSWORD', 10),
        role: 'admin',
        name: 'Admin',
      },
    });
    console.log('Admin created.');
  })();
"
```

После первого логина смени пароль через `/account/password`.

---

## Обновления (CD)

```bash
ssh root@89.126.211.117
cd /opt/bigmax
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` service автоматом применит новые миграции перед запуском web.
Zero-downtime пока что не настроен — `web` рестартует ~3-5 сек.

---

## Бэкапы

### Postgres

```bash
# Дамп БД (запускать раз в сутки через cron):
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U bigmax bigmax | gzip > /opt/backups/bigmax-$(date +%F).sql.gz
```

### Uploads (картинки товаров)

```bash
# Volume backup (raw tar):
docker run --rm -v domtextile-prod_uploads-data:/data -v /opt/backups:/backup \
  alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Положи оба в crontab + rsync на off-site storage.

---

## Логи и диагностика

```bash
# Все сервисы:
docker compose -f docker-compose.prod.yml logs -f
# Только web:
docker compose -f docker-compose.prod.yml logs -f web
# Caddy (TLS issues, request log):
docker compose -f docker-compose.prod.yml logs -f caddy
# Worker (BullMQ jobs):
docker compose -f docker-compose.prod.yml logs -f worker
```

Image cleanup orphan-сборщик через admin UI:
`https://domtextile.uz/ru/admin/images-cleanup`.

---

## Известные ограничения

- **Single-server**: нет high-availability. Если сервер падает — даунтайм
  до перезагрузки.
- **Local FS uploads**: картинки на диске сервера (Docker volume). Phase 6
  (S3/Vercel Blob migration) — в roadmap'е `docs/admin/image-upload.md`.
- **No CDN**: Caddy сам serv'ит static + images. Для большого трафика —
  поставить Cloudflare CDN перед Caddy (free plan хватит).
- **3.8 GiB RAM**: tight для одновременных image-upload'ов с AVIF-encoding'ом.
  Sharp на 4MP фото в AVIF может занимать 500MB+. При проблемах — апгрейд
  RAM или добавить swap.
