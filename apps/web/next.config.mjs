import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: Next копирует все runtime-зависимости (включая
  // workspace-packages) в `.next/standalone/`, готовые для Docker runner-stage.
  // Production deploy запускается как `node apps/web/server.js`.
  output: "standalone",
  // Monorepo trace root: Next по дефолту угадывает workspace-root по lockfile,
  // что иногда даёт warning'и при множественных lockfile'ах. Указываем явно.
  outputFileTracingRoot: process.env.NODE_ENV === "production" ? "/app" : undefined,
  // Воркспейс-пакеты экспортируют TS-исходники — Next должен их транспилировать.
  transpilePackages: [
    "@bigmax/shared-types",
    "@bigmax/i18n",
    "@bigmax/db",
    "@bigmax/notifications",
  ],
  images: {
    remotePatterns: [
      // placehold.co — заглушки до загрузки реальных фото товаров (P2-T5).
      { protocol: "https", hostname: "placehold.co" },
      // Реальный CDN для prod — Cloudinary (пакет в техстеке, раздел 3 спеки).
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
  experimental: {
    typedRoutes: false,
  },
};

export default withNextIntl(nextConfig);
