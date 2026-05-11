/**
 * GET /api/products/[slug]
 *
 * Публичный endpoint для Quick View в каталоге: возвращает `ProductDetail`
 * по slug'у. Не требует авторизации; `isActive=false` → 404. Кеш короткий,
 * т.к. Stock может меняться.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getProductBySlug } from "@/server/catalog";
import { getCategoryAttributes } from "@/server/category-attributes";

const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9-]+$/);

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } },
): Promise<NextResponse> {
  const parsed = SlugSchema.safeParse(params.slug);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const product = await getProductBySlug(parsed.data);
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const attributeConfigs = await getCategoryAttributes(product.category.id);

  return NextResponse.json(
    { product, attributeConfigs },
    {
      headers: {
        // 30 сек CDN-кеш: Stock обновляется небыстро, overstale допустим.
        "cache-control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
