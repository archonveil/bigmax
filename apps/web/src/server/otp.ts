/**
 * Redis-backed one-time-password store.
 *
 *   - Код: 6 цифр, crypto.randomInt (uniform, без bias).
 *   - TTL: 5 минут.
 *   - Rate-limit: 60 сек между запросами на один телефон.
 *   - После успешной верификации код удаляется (одноразовость).
 */

import crypto from "node:crypto";

import { buildOtpSmsText, getEskizClient } from "@bigmax/notifications";
import { DEFAULT_LOCALE, isLocale, toE164 } from "@bigmax/shared-types";

import { getRedis } from "./redis";

const OTP_TTL_SECONDS = 300; // 5 минут
const RATE_LIMIT_SECONDS = 60;

const codeKey = (phone: string): string => `otp:code:${phone}`;
const rateKey = (phone: string): string => `otp:rate:${phone}`;

export type OtpRequestResult =
  | { ok: true }
  | { ok: false; reason: "invalid_phone" | "rate_limited" };

export async function requestOtp(rawPhone: string, rawLocale?: string): Promise<OtpRequestResult> {
  const phone = toE164(rawPhone);
  if (phone === null) return { ok: false, reason: "invalid_phone" };

  const locale = rawLocale && isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const redis = getRedis();
  const limited = await redis.get(rateKey(phone));
  if (limited) return { ok: false, reason: "rate_limited" };

  const code = crypto.randomInt(100_000, 1_000_000).toString();
  await redis.set(codeKey(phone), code, "EX", OTP_TTL_SECONDS);
  await redis.set(rateKey(phone), "1", "EX", RATE_LIMIT_SECONDS);

  const text = await buildOtpSmsText(locale, code);
  await getEskizClient().sendSms({ phone, text });

  return { ok: true };
}

/**
 * Возвращает нормализованный E.164 телефон, если код корректен,
 * иначе — null. Код удаляется сразу после успешной проверки.
 */
export async function verifyOtp(rawPhone: string, code: string): Promise<string | null> {
  const phone = toE164(rawPhone);
  if (phone === null) return null;
  if (!/^\d{6}$/.test(code)) return null;

  const redis = getRedis();
  const stored = await redis.get(codeKey(phone));
  if (stored === null || stored !== code) return null;

  await redis.del(codeKey(phone));
  return phone;
}
