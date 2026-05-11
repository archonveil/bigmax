/**
 * `GET /api/admin/orders/[id]/invoice.pdf` (P6-T5).
 *
 * Server-side рендеринг PDF-накладной через `@react-pdf/renderer`.
 * runtime = 'nodejs' обязателен — `@react-pdf/renderer` использует
 * Node API'ы (Buffer, fs для шрифтов), Edge runtime не поддерживается.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/server/admin-auth";
import { getAdminOrder } from "@/server/admin-orders";
import { renderOrderInvoicePdf } from "@/server/order-invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const order = await getAdminOrder(ctx.params.id);
  if (!order) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const pdf = await renderOrderInvoicePdf(order, { locale: order.locale });
  const filename = `bigmax-invoice-${order.number}.pdf`;
  // Buffer → Uint8Array, чтобы тип-чекался BodyInit (Node Buffer не входит в DOM-типы).
  const body = new Uint8Array(pdf);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
