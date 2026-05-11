/**
 * `POST /api/admin/images/cleanup-orphans` — удаляет orphan'ные filesystem-
 * папки картинок (Phase 7).
 *
 * Body: `{ dryRun?: boolean, minAgeHours?: number }`.
 *
 * Auth: admin/manager. Rate-limit: 5 calls/min/userId (защита от случайных
 * back-to-back triggers'ов — full FS scan тяжёлый).
 *
 * См. `apps/web/src/server/orphan-images.ts` для алгоритма.
 * См. `docs/admin/image-upload.md` Phase 7 для context'а.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/server/admin-auth";
import { DEFAULT_MIN_AGE_MS, runOrphanCleanup } from "@/server/orphan-images";
import { enforceRateLimit } from "@/server/rate-limit";

const BodySchema = z.object({
  dryRun: z.boolean().default(false),
  /** Минимальный возраст файла в часах для удаления. Default = 24h. */
  minAgeHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
});

const RATE_LIMIT_PER_MIN = 5;

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Rate-limit — full FS-scan + DB-fetch для большой галереи может занимать
  // секунды. Защита от случайного «Run» × 10 раз подряд.
  const rl = await enforceRateLimit({
    key: `orphan-cleanup:${auth.userId}`,
    limit: RATE_LIMIT_PER_MIN,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: unknown = {};
  try {
    // Body опциональный — POST {} тоже валиден (dryRun=false, default age).
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { dryRun, minAgeHours } = parsed.data;
  const minAgeMs = minAgeHours !== undefined ? minAgeHours * 60 * 60 * 1000 : DEFAULT_MIN_AGE_MS;

  try {
    const result = await runOrphanCleanup({ dryRun, minAgeMs });
    return NextResponse.json(
      {
        ok: true,
        dryRun,
        minAgeHours: Math.round(minAgeMs / (60 * 60 * 1000)),
        scanned: result.scanned,
        referenced: result.referenced,
        orphanCandidates: result.orphanCandidates,
        toDeleteCount: result.toDelete.length,
        // Самплируем первые 50 — full list может быть огромным.
        toDelete: result.toDelete.slice(0, 50).map((o) => ({
          shard: o.shard,
          hash: o.hash,
          ageHours: Math.round(o.ageMs / (60 * 60 * 1000)),
          bytes: o.bytes,
        })),
        deleted: result.deleted,
        bytesFreed: result.bytesFreed,
        errors: result.errors.slice(0, 20),
      },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    console.error("[admin/images/cleanup-orphans] failed", err);
    return NextResponse.json({ ok: false, reason: "internal_error" }, { status: 500 });
  }
}
