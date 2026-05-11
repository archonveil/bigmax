/**
 * P7-T2 sub-task O: тесты `getMaintenanceMessage` + feature-key sanity.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};
const fakeFeatureFindUnique = vi.fn();

vi.mock("@/server/redis", () => ({ getRedis: () => fakeRedis }));
vi.mock("@bigmax/db", () => ({
  prisma: {
    feature: { findUnique: (...args: unknown[]) => fakeFeatureFindUnique(...args) },
  },
}));

const { getMaintenanceMessage, BRAND_MAINTENANCE_MESSAGE_FEATURE_KEY } =
  await import("./maintenance");

beforeEach(() => {
  fakeRedis.get.mockReset();
  fakeRedis.set.mockReset();
  fakeFeatureFindUnique.mockReset();
});

describe("getMaintenanceMessage", () => {
  it("feature key совпадает с seed-row из миграции", () => {
    expect(BRAND_MAINTENANCE_MESSAGE_FEATURE_KEY).toBe("brand.maintenance_message");
  });

  it("row.value='' → '' (banner выключен)", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({ value: "", type: "string" });
    expect(await getMaintenanceMessage()).toBe("");
  });

  it("row.value=non-empty → возвращаем текст", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce({
      value: "Сайт работает в режиме ограниченного функционала",
      type: "string",
    });
    expect(await getMaintenanceMessage()).toBe("Сайт работает в режиме ограниченного функционала");
  });

  it("row отсутствует → '' (fallback)", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeFeatureFindUnique.mockResolvedValueOnce(null);
    expect(await getMaintenanceMessage()).toBe("");
  });

  it("cache hit → возвращаем без DB-hit", async () => {
    fakeRedis.get.mockResolvedValueOnce("Hello world");
    expect(await getMaintenanceMessage()).toBe("Hello world");
    expect(fakeFeatureFindUnique).not.toHaveBeenCalled();
  });
});
