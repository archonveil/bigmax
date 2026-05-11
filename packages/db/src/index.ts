/**
 * PrismaClient singleton для Бигмах.
 *
 * В dev (HMR) Next.js реинициализирует модули часто — без singleton'а мы
 * плодим десятки открытых соединений к Postgres. Глобальная переменная
 * на globalThis решает проблему.
 *
 * **BigInt → number coercion (P-money-to-bigint):**
 * Все *_cents колонки в БД — `BIGINT` (PG int8). Prisma по дефолту мапит
 * это на JS `bigint`, что было бы инфекционно для всего app-кода (math,
 * JSON-сериализация ломаются, comparison-operators требуют `n`-литералов).
 *
 * Стратегия: храним в БД как BigInt (никаких ограничений по сумме), а в
 * приложении остаёмся на `number`. Все суммы влезают в Number.MAX_SAFE_INTEGER
 * (2^53 ≈ 9e15) с огромным запасом — UZS-цены не дотягивают и до 1e12.
 *
 * `$extends.result` коэрсит BigInt → number на ЧТЕНИИ. Запись в Prisma
 * BigInt-поле принимает `number | bigint` на input — отдельной обёртки
 * на write-сайтах не требуется.
 *
 * **Lazy initialisation:** `transpilePackages: ["@bigmax/db"]` в Next.js
 * заставляет компилировать этот пакет для всех бандлов (включая client).
 * Если модуль грузится в браузере (через transitive `import type`), то
 * eager `new PrismaClient(...)` упадёт. Поэтому мы оборачиваем экспорт
 * в Proxy — `$extends` и `new PrismaClient()` срабатывают только при
 * РЕАЛЬНОМ обращении к `prisma.foo`, что в браузерном коде не происходит.
 */

import { PrismaClient } from "@prisma/client";

const toNum = (b: bigint | null): number | null => (b === null ? null : Number(b));
const toNumReq = (b: bigint): number => Number(b);

const RESULT_EXTENSIONS = {
  productVariant: {
    priceCents: {
      needs: { priceCents: true },
      compute: (v: { priceCents: bigint }): number => toNumReq(v.priceCents),
    },
    oldPriceCents: {
      needs: { oldPriceCents: true },
      compute: (v: { oldPriceCents: bigint | null }): number | null => toNum(v.oldPriceCents),
    },
  },
  order: {
    subtotalCents: {
      needs: { subtotalCents: true },
      compute: (o: { subtotalCents: bigint }): number => toNumReq(o.subtotalCents),
    },
    deliveryCostCents: {
      needs: { deliveryCostCents: true },
      compute: (o: { deliveryCostCents: bigint }): number => toNumReq(o.deliveryCostCents),
    },
    discountCents: {
      needs: { discountCents: true },
      compute: (o: { discountCents: bigint }): number => toNumReq(o.discountCents),
    },
    totalCents: {
      needs: { totalCents: true },
      compute: (o: { totalCents: bigint }): number => toNumReq(o.totalCents),
    },
  },
  orderItem: {
    priceCents: {
      needs: { priceCents: true },
      compute: (i: { priceCents: bigint }): number => toNumReq(i.priceCents),
    },
  },
  payment: {
    amountCents: {
      needs: { amountCents: true },
      compute: (p: { amountCents: bigint }): number => toNumReq(p.amountCents),
    },
  },
  refund: {
    amountCents: {
      needs: { amountCents: true },
      compute: (r: { amountCents: bigint }): number => toNumReq(r.amountCents),
    },
  },
  promo: {
    minOrderCents: {
      needs: { minOrderCents: true },
      compute: (p: { minOrderCents: bigint }): number => toNumReq(p.minOrderCents),
    },
  },
} as const;

function createExtendedClient() {
  const baseClient =
    (globalThis as unknown as { __bigmaxPrismaBase?: PrismaClient }).__bigmaxPrismaBase ??
    new PrismaClient({
      log: process.env["NODE_ENV"] === "development" ? ["query", "error", "warn"] : ["error"],
    });

  if (process.env["NODE_ENV"] !== "production") {
    (globalThis as unknown as { __bigmaxPrismaBase?: PrismaClient }).__bigmaxPrismaBase =
      baseClient;
  }

  return baseClient.$extends({ result: RESULT_EXTENSIONS });
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

/**
 * Тип `tx` внутри `prisma.$transaction(async (tx) => …)` для
 * расширенного клиента. Используется в helper'ах вроде
 * `reserveOrderStock({ tx })`, чтобы принимать как «голый» Prisma TX,
 * так и наш extended.
 */
export type TransactionClient = Parameters<Parameters<ExtendedPrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as {
  __bigmaxPrismaExtended: ExtendedPrismaClient | undefined;
};

/**
 * Lazy proxy. PrismaClient + $extends создаются при ПЕРВОМ обращении к
 * `prisma.<anything>`. Если модуль случайно загрузился в браузере (через
 * `transpilePackages` + transitive type-imports), сам факт загрузки не
 * упадёт — упадёт только реальный вызов, чего в client-коде не бывает.
 */
export const prisma = new Proxy({} as ExtendedPrismaClient, {
  get(_target, prop, receiver) {
    if (!globalForPrisma.__bigmaxPrismaExtended) {
      globalForPrisma.__bigmaxPrismaExtended = createExtendedClient();
    }
    return Reflect.get(globalForPrisma.__bigmaxPrismaExtended, prop, receiver);
  },
});

export * from "@prisma/client";
