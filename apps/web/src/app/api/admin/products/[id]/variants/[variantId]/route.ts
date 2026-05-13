/**
 * `PATCH /api/admin/products/[id]/variants/[variantId]` — update variant.
 * `DELETE /api/admin/products/[id]/variants/[variantId]` — hard-delete.
 *
 * DELETE: OrderItem.variantId is now nullable (SetNull FK), so hard-delete is
 * always safe. Existing order rows keep productSnapshot; variantId becomes NULL.
 * Image files on disk are cleaned up via fire-and-forget orphan cleanup.
 */

import { Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { syncProductColorFromVariants } from "@/server/admin-products";
import { VariantUpdateSchema } from "@/server/admin-variants";
import { runOrphanCleanup } from "@/server/orphan-images";

interface RouteContext {
  params: { id: string; variantId: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = VariantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  // Verify variant existence + ownership; нам нужен current color для resolve'а
  // replace-set'а по color-group'е (если color не передан в payload'е).
  const existing = await prisma.productVariant.findFirst({
    where: { id: ctx.params.variantId, productId: ctx.params.id },
    select: { id: true, color: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const data = parsed.data;
  try {
    // Variant update + images replace-set в одной transaction'е.
    const updated = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({
        where: { id: ctx.params.variantId },
        data: {
          ...(data.sku !== undefined ? { sku: data.sku } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
          ...(data.size !== undefined ? { size: data.size } : {}),
          ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
          ...(data.oldPriceCents !== undefined ? { oldPriceCents: data.oldPriceCents } : {}),
          ...(data.barcode !== undefined ? { barcode: data.barcode } : {}),
          ...(data.weightGrams !== undefined ? { weightGrams: data.weightGrams } : {}),
        },
        select: { id: true, sku: true },
      });
      // Images replace-set: по color-group'е (если у варианта есть color) ИЛИ
      // per-variant (для variant'ов различающихся только размером). После
      // update'а variant.color мог уже измениться — используем новое значение.
      if (data.images !== undefined) {
        const newColor = data.color !== undefined ? data.color : existing.color;
        if (newColor !== null && newColor !== "") {
          // Color-group: чистим всё в этой group'е и записываем заново.
          // Sibling-варианты того же цвета увидят обновлённый набор.
          await tx.productImage.deleteMany({
            where: { productId: ctx.params.id, colorTag: newColor },
          });
          // Заодно: если variant перекрасили (color изменили), чистим старую
          // color-group'у тоже, чтобы её variant'ы не «застряли» с предыдущим
          // set'ом (там старые картинки больше не релевантны).
          if (
            data.color !== undefined &&
            existing.color !== null &&
            existing.color !== "" &&
            existing.color !== newColor
          ) {
            await tx.productImage.deleteMany({
              where: { productId: ctx.params.id, colorTag: existing.color },
            });
          }
          if (data.images.length > 0) {
            await tx.productImage.createMany({
              data: data.images.map((img, i) => ({
                productId: ctx.params.id,
                variantId: null,
                colorTag: newColor,
                url: img.url,
                alt: img.alt ?? null,
                order: img.order ?? i,
                sizes:
                  img.sizes && Object.keys(img.sizes).length > 0
                    ? (img.sizes as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                avifSizes:
                  img.avifSizes && Object.keys(img.avifSizes).length > 0
                    ? (img.avifSizes as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
              })),
            });
          }
        } else {
          // Per-variant fallback (no color).
          await tx.productImage.deleteMany({
            where: { productId: ctx.params.id, variantId: ctx.params.variantId },
          });
          if (data.images.length > 0) {
            await tx.productImage.createMany({
              data: data.images.map((img, i) => ({
                productId: ctx.params.id,
                variantId: ctx.params.variantId,
                colorTag: null,
                url: img.url,
                alt: img.alt ?? null,
                order: img.order ?? i,
                sizes:
                  img.sizes && Object.keys(img.sizes).length > 0
                    ? (img.sizes as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                avifSizes:
                  img.avifSizes && Object.keys(img.avifSizes).length > 0
                    ? (img.avifSizes as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
              })),
            });
          }
        }
      }
      return variant;
    });
    // Re-sync color: variant.color могло измениться → product.attributes.color
    // должен переотразить агрегацию.
    if (data.color !== undefined) {
      await syncProductColorFromVariants(ctx.params.id);
    }
    return NextResponse.json(
      { ok: true, id: updated.id, sku: updated.sku },
      { status: 200, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : null;
    if (code === "P2002") {
      return NextResponse.json({ ok: false, reason: "sku_exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const existing = await prisma.productVariant.findFirst({
    where: { id: ctx.params.variantId, productId: ctx.params.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  await prisma.productVariant.delete({
    where: { id: ctx.params.variantId },
    select: { id: true },
  });
  await syncProductColorFromVariants(ctx.params.id);

  // Fire-and-forget: clean up image files whose DB rows were just cascade-deleted.
  void runOrphanCleanup({ minAgeMs: 0 }).catch(() => undefined);

  return NextResponse.json(
    { ok: true, deleted: true },
    { status: 200, headers: { "Cache-Control": "no-store, private" } },
  );
}
