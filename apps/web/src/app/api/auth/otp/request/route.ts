/**
 * POST /api/auth/otp/request
 *
 * Принимает `{ phone, locale? }`, генерирует 6-значный код в Redis,
 * шлёт SMS через Eskiz (или mock в dev), и всегда возвращает 200 + `{ ok }`.
 *
 * Rate-limit: 1 запрос в 60 секунд на номер.
 */

import { NextResponse, type NextRequest } from "next/server";

import { OtpRequestSchema } from "@/auth";
import { requestOtp } from "@/server/otp";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const parsed = OtpRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const result = await requestOtp(parsed.data.phone, parsed.data.locale);

  if (!result.ok && result.reason === "invalid_phone") {
    return NextResponse.json({ ok: false, reason: "invalid_phone" }, { status: 400 });
  }
  if (!result.ok && result.reason === "rate_limited") {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  return NextResponse.json({ ok: true });
}
