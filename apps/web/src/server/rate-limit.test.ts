import { describe, expect, it } from "vitest";

import { clientIpFromHeaders, enforceRateLimit } from "./rate-limit";

describe("clientIpFromHeaders", () => {
  it("берёт первый IP из x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });

  it("trim'ит whitespace", () => {
    const h = new Headers({ "x-forwarded-for": "  1.2.3.4  " });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });

  it("fallback на x-real-ip когда нет XFF", () => {
    const h = new Headers({ "x-real-ip": "5.6.7.8" });
    expect(clientIpFromHeaders(h)).toBe("5.6.7.8");
  });

  it("предпочитает XFF над x-real-ip", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });

  it("ни одного — 'unknown'", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("пустой XFF → fallback", () => {
    const h = new Headers({ "x-forwarded-for": "", "x-real-ip": "5.6.7.8" });
    expect(clientIpFromHeaders(h)).toBe("5.6.7.8");
  });
});

describe("enforceRateLimit · fail-open", () => {
  it("Redis недоступен → ok:true (fail-open) — webhook не должен валиться из-за Redis", async () => {
    // В unit-окружении REDIS_URL не задан → getRedis() кидает → catch → ok:true.
    const res = await enforceRateLimit({
      key: "test:fail-open",
      limit: 100,
      windowSec: 60,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.remaining).toBe(100);
  });

  it("limit=0 → всегда ok:false (защитный degenerate case)", async () => {
    const res = await enforceRateLimit({ key: "test:zero", limit: 0, windowSec: 60 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSec).toBe(60);
  });
});
