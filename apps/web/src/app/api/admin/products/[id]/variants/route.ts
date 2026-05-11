/**
 * `POST /api/admin/products/[id]/variants` — create variant (P6-T3 follow-up).
 *
 * Owner — Product. Если productId не существует → 404. Уникальность по
 * `sku` глобальна (не per-product) → 409 на конфликт.
 */

import { Prisma, prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { syncProductColorFromVariants } from "@/server/admin-products";
import { VariantCreateSchema } from "@/server/admin-variants";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
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
  const parsed = VariantCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: "invalid_body", message: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  // 404 на отсутствующий productId — иначе FK даст 400 без user-friendly reason.
  const product = await prisma.product.findUnique({
    where: { id: ctx.params.id },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const data = parsed.data;
  try {
    // Атомарно: variant + zero-stock rows для всех активных филиалов + images.
    // Без stock-инициализации новый variant не появлялся бы на /admin/stock.
    const created = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: data.sku,
          color: data.color ?? null,
          size: data.size ?? null,
          priceCents: data.priceCents,
          oldPriceCents: data.oldPriceCents ?? null,
          barcode: data.barcode ?? null,
          weightGrams: data.weightGrams ?? null,
        },
        select: { id: true, sku: true },
      });
      const branches = await tx.storeBranch.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      if (branches.length > 0) {
        await tx.stock.createMany({
          data: branches.map((b) => ({
            variantId: variant.id,
            branchId: b.id,
            quantity: 0,
            reserved: 0,
          })),
          skipDuplicates: true,
        });
      }
      // Картинки сохраняем как color-group (colorTag = variant.color) если
      // у варианта есть color. Это shared-set: все sibling-варианты того же
      // цвета увидят те же картинки. Для variant'ов без color (только size)
      // fallback на per-variant linkage (`variantId`).
      if (data.images && data.images.length > 0) {
        const color = data.color ?? null;
        // Если color есть — replace-set по color-group'е чтобы не было дублей
        // от sibling'ов. Если color нет — пишем per-variant.
        if (color !== null && color !== "") {
          await tx.productImage.deleteMany({
            where: { productId: product.id, colorTag: color },
          });
          await tx.productImage.createMany({
            data: data.images.map((img, i) => ({
              productId: product.id,
              variantId: null,
              colorTag: color,
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
        } else {
          await tx.productImage.createMany({
            data: data.images.map((img, i) => ({
              productId: product.id,
              variantId: variant.id,
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
      return variant;
    });
    await syncProductColorFromVariants(product.id);
    return NextResponse.json(
      { ok: true, id: created.id, sku: created.sku },
      { status: 201, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : null;
    if (code === "P2002") {
      // Можно попасть либо на sku-unique, либо в будущем на barcode-unique.
      return NextResponse.json({ ok: false, reason: "sku_exists" }, { status: 409 });
    }
    throw err;
  }
}
