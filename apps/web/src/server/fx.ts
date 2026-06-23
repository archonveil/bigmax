/**
 * FX rate provider — UZS-per-1-unit-of-foreign-currency.
 *
 * Site prices are stored in UZS tiyin (`Order.totalCents`), but the live
 * Uniteller shop is configured for USD (see route.ts at /api/checkout/pay).
 * Without conversion, a 160,074 soum order would be charged as $160,074 — a
 * ~12,700× overcharge. So we convert at checkout time using the official CBU
 * (Central Bank of Uzbekistan) rate, cached in Redis to keep latency near 0.
 *
 * Fallback chain (fail-open for UX, fail-loud via Sentry for ops):
 *   1. Redis cache hit → return cached rate.
 *   2. Cache miss → fetch from cbu.uz, store in Redis with 12h TTL.
 *   3. cbu.uz fails (timeout, 5xx, bad JSON) → fall back to `UNITELLER_UZS_RATE`
 *      env var (default 12700). Log to Sentry so ops can fix the source if
 *      cbu.uz outage persists, but checkout keeps working.
 *
 * The CBU updates rates once per business day (~14:00 Tashkent), so a 12h TTL
 * means at most one stale-rate day if their API is down — acceptable.
 */
import { reportError } from "./observability";
import { getRedis } from "./redis";

/** Redis key for the cached USD rate. */
const CACHE_KEY = "fx:uzs:USD";
/** 12 hours — CBU updates rates ~once per business day. */
const CACHE_TTL_SEC = 12 * 60 * 60;
/** 3 seconds — enough for cbu.uz round-trip, low enough not to block checkout. */
const FETCH_TIMEOUT_MS = 3000;

/** Hardcoded fallback used only if env var is missing AND CBU is unreachable. */
const HARDCODED_FALLBACK = 12700;

/**
 * Returns soums (whole, not tiyin) per 1 USD. Always returns a positive
 * number — never throws — so callers can do `cents / rate` without guarding.
 */
export async function getUsdRate(): Promise<number> {
  // 1. Cache hit
  try {
    const cached = await getRedis().get(CACHE_KEY);
    const parsed = cached === null ? null : Number.parseFloat(cached);
    if (parsed && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch (err) {
    // Redis down — log but keep going (cbu.uz might still work).
    reportError(err, { scope: "web.fx.redis.get" });
  }

  // 2. Fetch from CBU
  const fresh = await fetchUsdRateFromCbu();
  if (fresh !== null) {
    // Best-effort cache write — failure here is non-fatal.
    try {
      await getRedis().setex(CACHE_KEY, CACHE_TTL_SEC, String(fresh));
    } catch (err) {
      reportError(err, { scope: "web.fx.redis.setex" });
    }
    return fresh;
  }

  // 3. Env-var fallback
  return readEnvFallback();
}

/**
 * Calls cbu.uz USD endpoint. Returns null on any failure (timeout, non-2xx,
 * unparseable response). Errors are logged to Sentry so an ongoing outage is
 * visible — we don't want to silently drift on a stale env-var rate forever.
 */
async function fetchUsdRateFromCbu(): Promise<number | null> {
  const url = "https://cbu.uz/oz/arkhiv-kursov-valyut/json/USD/";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      reportError(new Error(`cbu.uz HTTP ${res.status}`), { scope: "web.fx.cbu.http" });
      return null;
    }
    // CBU returns an array of one element: `[{ "Ccy": "USD", "Rate": "12600.00", ... }]`.
    const body = (await res.json()) as Array<{ Ccy?: string; Rate?: string }>;
    const usd = Array.isArray(body) ? body.find((row) => row.Ccy === "USD") : null;
    const rate = usd?.Rate ? Number.parseFloat(usd.Rate) : NaN;
    if (!Number.isFinite(rate) || rate <= 0) {
      reportError(new Error(`cbu.uz returned unparseable rate: ${usd?.Rate}`), {
        scope: "web.fx.cbu.parse",
      });
      return null;
    }
    // Sanity bounds: if CBU returns something wildly off (e.g. 1 or 1000000),
    // refuse to trust it. UZS/USD has been in [10000, 20000] for years.
    if (rate < 5000 || rate > 50000) {
      reportError(new Error(`cbu.uz rate outside sanity bounds: ${rate}`), {
        scope: "web.fx.cbu.sanity",
      });
      return null;
    }
    return rate;
  } catch (err) {
    reportError(err, { scope: "web.fx.cbu.fetch" });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readEnvFallback(): number {
  const raw = process.env["UNITELLER_UZS_RATE"];
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return HARDCODED_FALLBACK;
}
