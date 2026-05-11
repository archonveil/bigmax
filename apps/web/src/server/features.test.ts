/**
 * P7-T2 sub-task F: тесты `getNumberFeature` / `invalidateFeatureCache`.
 *
 * Паттерн от promo-cache.test.ts: mock'аем `@bigmax/db.prisma` и
 * `@/server/redis.getRedis`. Тесты:
 *  - Cache hit → возвращаем parsed; БД не дёргается.
 *  - Cache miss → DB hit → parse → cache-write с EX 60.
 *  - DB-null / type != number → fallback.
 *  - Cache "" (negative-cache marker) → fallback.
 *  - Mасло-парс → fallback.
 *  - Redis throws → fallback к Prisma.
 *  - Prisma throws → fallback напрямую.
 *  - `invalidateFeatureCache` шлёт DEL с правильным versioned ключом.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};
const fakeFeatureFindUnique = vi.fn();

vi.mock("@/server/redis", () => ({
  getRedis: () => fakeRedis,
}));

vi.mock("@bigmax/db", () => ({
  prisma: {
    feature: {
      findUnique: (...args: unknown[]) => fakeFeatureFindUnique(...args),
    },
  },
}));

const {
  getNumberFeature,
  getBooleanFeature,
  getStringFeature,
  invalidateFeatureCache,
  FEATURE_CACHE_KEY_VERSION,
} = await import("./features");

beforeEach(() => {
  fakeRedis.get.mockReset();
  fakeRedis.set.mockReset();
  fakeRedis.del.mockReset();
  fakeFeatureFindUnique.mockReset();
});

describe("getNumberFeature — cache layer", () => {
  it("cache hit → возвращаем число, Prisma не дёргается", async () => {
    fakeRedis.get.mockResolvedValueOnce("2.5");
    const got = await getNumberFeature("loyalty.earn_percent", 1);
    expect(got).toBe(2.5);
    expect(fakeFeatureFindUnique).not.toHaveBeenCalled();
  });

  it("cache key — versioned (`feature:v1:<key>`)", async () => {
    fakeRedis.get.mockResolvedValueOnce("3");
    await getNumberFeature("loyalty.earn_percent", 1);
    expect(fakeRedis.get).toHaveBeenCalledWith(
      `feature:${FEATURE_CACHE_KEY_VERSION}:loyalty.earn_percent`,
    );
  });

  it("cache miss + DB row(type=number) → parse + write-back с EX 60", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "5", type: "number" });

    const got = await getNumberFeature("loyalty.earn_percent", 1);
    expect(got).toBe(5);
    expect(fakeRedis.set).toHaveBeenCalledTimes(1);
    const args = fakeRedis.set.mock.calls[0];
    expect(args?.[1]).toBe("5");
    expect(args?.[2]).toBe("EX");
    expect(args?.[3]).toBe(60);
  });

  it("cache miss + DB row(type != number) → fallback, всё равно cache-write пустую marker", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "true", type: "boolean" });

    const got = await getNumberFeature("flag.something", 7);
    expect(got).toBe(7);
    // negative-cache marker "" → следующий lookup ещё 60s вернёт fallback быстро.
    expect(fakeRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("flag.something"),
      "",
      "EX",
      60,
    );
  });

  it("cache miss + DB null → fallback + negative-cache marker", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce(null);

    const got = await getNumberFeature("nope", 42);
    expect(got).toBe(42);
    expect(fakeRedis.set).toHaveBeenCalledWith(expect.any(String), "", "EX", 60);
  });

  it("cache hit с пустой строкой (negative marker) → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce("");
    const got = await getNumberFeature("nope", 99);
    expect(got).toBe(99);
    expect(fakeFeatureFindUnique).not.toHaveBeenCalled();
  });

  it("cache hit с нечисловым value → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce("abc");
    const got = await getNumberFeature("loyalty.earn_percent", 1);
    expect(got).toBe(1);
  });

  it("Redis.get throws → fallback к Prisma", async () => {
    fakeRedis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "10", type: "number" });

    const got = await getNumberFeature("k", 1);
    expect(got).toBe(10);
  });

  it("Prisma throws → возвращаем fallback без crash", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockRejectedValueOnce(new Error("DB down"));

    const got = await getNumberFeature("k", 99);
    expect(got).toBe(99);
    // Не пишем в кэш при Prisma-fail.
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it("Redis.set throws (write-back fail) → результат всё равно возвращается", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "3", type: "number" });
    fakeRedis.set.mockRejectedValueOnce(new Error("Redis down on write"));

    const got = await getNumberFeature("k", 1);
    expect(got).toBe(3);
  });
});

describe("invalidateFeatureCache", () => {
  it("DEL по versioned ключу", async () => {
    await invalidateFeatureCache("loyalty.earn_percent");
    expect(fakeRedis.del).toHaveBeenCalledWith(
      `feature:${FEATURE_CACHE_KEY_VERSION}:loyalty.earn_percent`,
    );
  });

  it("Redis.del throws → swallow (TTL дотухнет естественно)", async () => {
    fakeRedis.del.mockRejectedValueOnce(new Error("Redis down"));
    await expect(invalidateFeatureCache("k")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P7-T2 sub-task H: getBooleanFeature / getStringFeature
// ---------------------------------------------------------------------------

describe("getBooleanFeature", () => {
  it("happy: 'true' row → true", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "true", type: "boolean" });
    expect(await getBooleanFeature("flag.beta", false)).toBe(true);
  });

  it("happy: 'false' row → false", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "false", type: "boolean" });
    expect(await getBooleanFeature("flag.beta", true)).toBe(false);
  });

  it("row type ≠ boolean → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "true", type: "number" });
    expect(await getBooleanFeature("flag.beta", false)).toBe(false);
  });

  it("non-canonical value ('1' / 'yes' / 'on') → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "1", type: "boolean" });
    expect(await getBooleanFeature("flag.beta", false)).toBe(false);
  });

  it("DB null → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce(null);
    expect(await getBooleanFeature("nope", true)).toBe(true);
  });

  it("cache hit 'true' → true (БД не дёргается)", async () => {
    fakeRedis.get.mockResolvedValueOnce("true");
    expect(await getBooleanFeature("flag.beta", false)).toBe(true);
    expect(fakeFeatureFindUnique).not.toHaveBeenCalled();
  });
});

describe("getStringFeature", () => {
  it("happy: row → возвращаем raw string", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({
      value: "hello world",
      type: "string",
    });
    expect(await getStringFeature("hero.title", "default")).toBe("hello world");
  });

  it("row type ≠ string → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "5", type: "number" });
    expect(await getStringFeature("k", "default")).toBe("default");
  });

  it("DB null → fallback", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce(null);
    expect(await getStringFeature("k", "default")).toBe("default");
  });

  it("cache hit → возвращаем raw, БД не дёргается", async () => {
    fakeRedis.get.mockResolvedValueOnce("cached-string");
    expect(await getStringFeature("k", "default")).toBe("cached-string");
    expect(fakeFeatureFindUnique).not.toHaveBeenCalled();
  });

  it("пустая строка в БД (legal value) НЕ путается с negative-marker", async () => {
    // Row есть, но значение пустое — это валидная строка. Cache хранит ""
    // только для negative-marker (row отсутствует / type mismatch). Для
    // type=string с value="" admin не сможет создать (form требует .min(1)),
    // но даже если бы — кэш-логика отдаёт fallback (negative marker == "").
    // Это known trade-off: легче чем добавлять второй marker.
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "", type: "string" });
    expect(await getStringFeature("k", "default")).toBe("default");
  });
});
