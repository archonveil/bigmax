/**
 * `POST /api/mock/uniteller/pay` — inline Uniteller mock for local dev.
 *
 * Only active when UNITELLER_MODE=mock and NODE_ENV≠production. Accepts the
 * same self-submit form as the real wpay.uniteller.ru/pay/, verifies the
 * Signature, fires a signed Authorized callback to /api/webhooks/uniteller,
 * then redirects to URL_RETURN_OK — completing the full payment flow without
 * any external service or separate process.
 *
 * To enable: set UNITELLER_MODE=mock in .env (already the default for dev).
 */

import { uniteller } from "@bigmax/payments";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env["UNITELLER_MODE"] !== "mock" || process.env["NODE_ENV"] === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const params = new URLSearchParams(body);
  const shopId = params.get("Shop_IDP") ?? "";
  const orderId = params.get("Order_IDP") ?? "";
  const subtotal = params.get("Subtotal_P") ?? "";
  const signature = params.get("Signature") ?? "";
  const lifetime = params.get("Lifetime") ?? "";
  const returnOkUrl = params.get("URL_RETURN_OK") ?? "";

  const password = process.env["UNITELLER_PASSWORD"] ?? "";

  const verify = uniteller.verifyPayForm({
    shopId,
    orderId,
    subtotal,
    signature,
    lifetime,
    password,
  });
  if (!verify.ok) {
    return new NextResponse(`Bad Request: ${verify.reason}`, { status: 400 });
  }

  const cbBody = uniteller.buildCallbackBody({
    orderId,
    status: "Authorized",
    password,
    billnumber: `MOCK-${Date.now()}`,
    cardMask: "4000 **** **** 2487",
  });

  const appUrl = (process.env["APP_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    await fetch(`${appUrl}/api/webhooks/uniteller`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: cbBody,
    });
  } catch {
    // Best-effort — the order's pull-job will reconcile on next recheck.
  }

  return NextResponse.redirect(
    returnOkUrl.startsWith("http") ? returnOkUrl : `${appUrl}${returnOkUrl}`,
  );
}
