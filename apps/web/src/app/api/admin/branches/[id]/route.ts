import { prisma } from "@bigmax/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { ACTIVE_BRANCHES_TAG } from "@/server/active-branches";
import { requireAdminSession } from "@/server/admin-auth";
import { BranchUpdateSchema, prismaErrorCode } from "@/server/admin-taxonomy";

interface Ctx {
  params: { id: string };
}

function bustBranchCaches(): void {
  revalidatePath("/[locale]/admin/branches", "page");
  revalidatePath("/[locale]/admin/branches/[id]", "page");
  // P1-11: ломаем `unstable_cache(getActiveBranches)`.
  revalidateTag(ACTIVE_BRANCHES_TAG);
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
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
  const parsed = BranchUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const exists = await prisma.storeBranch.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  const data = parsed.data;
  try {
    await prisma.storeBranch.update({
      where: { id: ctx.params.id },
      data: {
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.nameRu !== undefined ? { nameRu: data.nameRu } : {}),
        ...(data.nameUz !== undefined ? { nameUz: data.nameUz } : {}),
        ...(data.nameEn !== undefined ? { nameEn: data.nameEn } : {}),
        ...(data.addressRu !== undefined ? { addressRu: data.addressRu } : {}),
        ...(data.addressUz !== undefined ? { addressUz: data.addressUz } : {}),
        ...(data.addressEn !== undefined ? { addressEn: data.addressEn } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.workingHours !== undefined ? { workingHours: data.workingHours } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: { id: true },
    });
    bustBranchCaches();
    return NextResponse.json({ ok: true, id: ctx.params.id }, { status: 200 });
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return NextResponse.json({ ok: false, reason: "slug_exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  // Order → StoreBranch onDelete:SetNull, hard-delete безопасен.
  const exists = await prisma.storeBranch.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  await prisma.storeBranch.delete({ where: { id: ctx.params.id }, select: { id: true } });
  bustBranchCaches();
  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}
