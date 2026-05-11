/**
 * `POST /api/admin/upload` — multipart-upload одного image-файла для админ-
 * формы товара/варианта.
 *
 * Auth: admin/manager. Rate-limit: 60 uploads/min/userId.
 *
 * Принимает `multipart/form-data` с полем `file`. Возвращает:
 *   `{ ok: true, url: "/uploads/products/..." }` — URL пишется в `ProductImage.url`.
 *
 * Pipeline: validate format → sharp process (WebP + multi-size + strip metadata)
 * → store на FS → JSON response.
 *
 * См. `docs/admin/image-upload.md` для full-context (Phase 1+2).
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { MAX_BYTES, processImage, type ProcessImageError } from "@/server/image-pipeline";
import { saveProcessed } from "@/server/image-storage";
import { enforceRateLimit } from "@/server/rate-limit";

const RATE_LIMIT_PER_MIN = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Rate-limit per admin user — защита от случайного infinite-loop'а в UI.
  const rl = await enforceRateLimit({
    key: `admin-upload:${auth.userId}`,
    limit: RATE_LIMIT_PER_MIN,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // Парсим multipart. Next 14 даёт нативный `req.formData()`.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "missing 'file' field" },
      { status: 400 },
    );
  }
  // Early size-check ПЕРЕД полным буферированием — экономим memory если файл
  // огромный. (Browser FormData всё равно пришлёт целиком, но `file.size`
  // известен до .arrayBuffer().)
  if (fileEntry.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: "file_too_large" }, { status: 413 });
  }

  const arrayBuffer = await fileEntry.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const result = await processImage(buffer);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason satisfies ProcessImageError },
      { status: errorStatus(result.reason) },
    );
  }

  let saved;
  try {
    saved = await saveProcessed(result.result);
  } catch (err) {
    console.error("[admin/upload] saveProcessed failed", err);
    return NextResponse.json({ ok: false, reason: "processing_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      url: saved.url,
      sizes: saved.sizes,
      avifSizes: saved.avifSizes,
      meta: result.result.meta,
    },
    { status: 201, headers: { "Cache-Control": "no-store, private" } },
  );
}

function errorStatus(reason: ProcessImageError): number {
  switch (reason) {
    case "file_too_large":
      return 413;
    case "unsupported_format":
    case "decode_failed":
    case "image_too_wide":
    case "image_too_tall":
      return 400;
    case "processing_failed":
      return 500;
  }
}
