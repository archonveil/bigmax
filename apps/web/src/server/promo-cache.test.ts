/**
 * P7-T1 sub-task B (OPT-010): Redis-cache над promo.findUnique.
 *
 * Mock'аем `@bigmax/db` (prisma) и `@/server/redis` (getRedis). Тестируем:
 *  - empty/whitespace код → no Redis / no DB touch.
 *  - cache hit → snapshot из Redis, БД не дёргается, даты десериализуются.
 *  - cache miss → DB → write-back с `EX 60`.
 *  - DB null → возвращаем null, в кэш не пишем (negative caching выключен).
 *  - Redis throws → fallback к Prisma.
 *  - invalidate использует UPPER+trim ключ.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromoSnapshot } from "./promo";

const fakeRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};
const fakePromoFindUnique = vi.fn();

vi.mock("@/server/redis", () => ({
  getRedis: () => fakeRedis,
}));

vi.mock("@bigmax/db", () => ({
  prisma: {
    promo: {
      findUnique: (...args: unknown[]) => fakePromoFindUnique(...args),
    },
  },
}));

// Импорт после mock'а — иначе модуль закэширует исходный getRedis/prisma.
const { getCachedPromoByCode, invalidatePromoCacheByCode } = await import("./promo");

const STARTS = new Date("2026-05-01T00:00:00Z");
const ENDS = new Date("2026-06-01T00:00:00Z");

function makeDbRow(): {
  code: string;
  type: "percent";
  value: number;
  minOrderCents: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
} {
  return {
    code: "SUMMER10",
    type: "percent",
    value: 10,
    minOrderCents: 50_000,
    startsAt: STARTS,
    endsAt: ENDS,
    usageLimit: 100,
    usedCount: 5,
    isActive: true,
  };
}

beforeEach(() => {
  fakeRedis.get.mockReset();
  fakeRedis.set.mockReset();
  fakeRedis.del.mockReset();
  fakePromoFindUnique.mockReset();
});

describe("getCachedPromoByCode", () => {
  it("пустой/whitespace код → null, ни Redis ни Prisma не трогаются", async () => {
    expect(await getCachedPromoByCode("")).toBeNull();
    expect(await getCachedPromoByCode("   ")).toBeNull();
    expect(fakeRedis.get).not.toHaveBeenCalled();
    expect(fakePromoFindUnique).not.toHaveBeenCalled();
  });

  it("cache hit → snapshot из Redis, БД не дёргается, даты десериализуются", async () => {
    fakeRedis.get.mockResolvedValueOnce(
      JSON.stringify({
        code: "SUMMER10",
        type: "percent",
        value: 10,
        minOrderCents: 50_000,
        startsAt: STARTS.toISOString(),
        endsAt: ENDS.toISOString(),
        usageLimit: 100,
        usedCount: 5,
        isActive: true,
      }),
    );

    const got = await getCachedPromoByCode("summer10");

    expect(fakeRedis.get).toHaveBeenCalledWith("promo:v1:SUMMER10");
    expect(fakePromoFindUnique).not.toHaveBeenCalled();
    expect(got).toMatchObject<PromoSnapshot>({
      code: "SUMMER10",
      type: "percent",
      value: 10,
      minOrderCents: 50_000,
      usageLimit: 100,
      usedCount: 5,
      isActive: true,
      startsAt: STARTS,
      endsAt: ENDS,
    });
  });

  it("cache miss → DB → write-back с `EX 60`", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakePromoFindUnique.mockResolvedValueOnce(makeDbRow());

    const got = await getCachedPromoByCode(" summer10 ");

    expect(fakeRedis.get).toHaveBeenCalledWith("promo:v1:SUMMER10");
    expect(fakePromoFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "SUMMER10" } }),
    );
    expect(fakeRedis.set).toHaveBeenCalledTimes(1);
    const setArgs = fakeRedis.set.mock.calls[0];
    expect(setArgs?.[0]).toBe("promo:v1:SUMMER10");
    expect(setArgs?.[2]).toBe("EX");
    expect(setArgs?.[3]).toBe(60);
    expect(got?.code).toBe("SUMMER10");
  });

  it("DB null → возвращаем null, в кэш НЕ пишем (negative caching off)", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakePromoFindUnique.mockResolvedValueOnce(null);

    const got = await getCachedPromoByCode("NOPE");

    expect(got).toBeNull();
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it("Redis.get throws → fallback к Prisma", async () => {
    fakeRedis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    fakePromoFindUnique.mockResolvedValueOnce(makeDbRow());

    const got = await getCachedPromoByCode("SUMMER10");

    expect(fakePromoFindUnique).toHaveBeenCalled();
    expect(got?.code).toBe("SUMMER10");
  });

  it("Redis.set throws (write-back fail) → результат всё равно возвращается", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakePromoFindUnique.mockResolvedValueOnce(makeDbRow());
    fakeRedis.set.mockRejectedValueOnce(new Error("Redis down on write"));

    const got = await getCachedPromoByCode("SUMMER10");

    expect(got?.code).toBe("SUMMER10");
  });

  it("ключ всегда trim+UPPER", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakePromoFindUnique.mockResolvedValueOnce(makeDbRow());

    await getCachedPromoByCode("  summer10  ");

    expect(fakeRedis.get).toHaveBeenCalledWith("promo:v1:SUMMER10");
  });
});

describe("invalidatePromoCacheByCode", () => {
  it("DEL по UPPER+trim ключу", async () => {
    await invalidatePromoCacheByCode("  summer10  ");
    expect(fakeRedis.del).toHaveBeenCalledWith("promo:v1:SUMMER10");
  });

  it("Redis.del throws → swallow (TTL дотухнет)", async () => {
    fakeRedis.del.mockRejectedValueOnce(new Error("Redis down"));
    await expect(invalidatePromoCacheByCode("ANY")).resolves.toBeUndefined();
  });
});
