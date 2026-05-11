/**
 * `POST /api/admin/promo` (P7-T1).
 *
 * Создаёт новый промокод. `code` нормализуется в UPPER. Уникальность
 * `code` ловится через P2002.
 *
 * Response:
 *  - 201 `{ ok, id, code }`
 *  - 400 invalid_body
 *  - 401/404 от requireAdminSession
 *  - 409 `{ ok: false, reason: "code_exists" }`
 */

import { prisma } from "@bigmax/db";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { PromoCreateSchema, prismaErrorCode } from "@/server/admin-promo";
import { invalidatePromoCacheByCode } from "@/server/promo";

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: "malformed JSON" },
      { status: 400 },
    );
  }
  const parsed = PromoCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    const created = await prisma.promo.create({
      data: {
        code: data.code,
        type: data.type,
        value: data.value,
        minOrderCents: data.minOrderCents,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        usageLimit: data.usageLimit ?? null,
        isActive: data.isActive,
      },
      select: { id: true, code: true },
    });
    revalidatePath("/[locale]/admin/promo", "page");
    // P7-T1 sub-task B: новый код мог затенять stale-кэш с тем же ключом
    // (если когда-то такой код существовал и был удалён без bust'а). Bust
    // дешёвый — `DEL` + промах при следующем validate.
    await invalidatePromoCacheByCode(created.code);
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "code_exists" }, { status: 409 });
    }
    throw err;
  }
}
