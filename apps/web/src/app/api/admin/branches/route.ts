import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { ACTIVE_BRANCHES_TAG } from "@/server/active-branches";
import { requireAdminSession } from "@/server/admin-auth";
import { BranchCreateSchema, prismaErrorCode } from "@/server/admin-taxonomy";

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
  const parsed = BranchCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const data = parsed.data;
  try {
    const created = await prisma.storeBranch.create({
      data: {
        slug: data.slug ?? null,
        nameRu: data.nameRu,
        nameUz: data.nameUz ?? "",
        nameEn: data.nameEn ?? "",
        addressRu: data.addressRu,
        addressUz: data.addressUz ?? "",
        addressEn: data.addressEn ?? "",
        phone: data.phone ?? null,
        workingHours: data.workingHours ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        isActive: data.isActive,
      },
      select: { id: true },
    });
    revalidatePath("/[locale]/admin/branches", "page");
    // P1-11: ломаем `unstable_cache(getActiveBranches)` (checkout, branches map).
    revalidateTag(ACTIVE_BRANCHES_TAG);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    throw err;
  }
}
