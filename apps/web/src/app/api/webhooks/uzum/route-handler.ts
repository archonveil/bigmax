import { prisma, type Prisma } from "@bigmax/db";
import { NextResponse, type NextRequest } from "next/server";

import { writePaymentLog } from "@/server/payment-log";

interface UzumParams {
  account?: string | number;
  order_id?: string | number;
  orderId?: string | number;
  order_number?: string | number;
  orderNumber?: string | number;
  [key: string]: unknown;
}

interface UzumCheckRequestBody {
  serviceId?: number | string;
  timestamp?: number;
  params?: UzumParams;
}

interface UzumCreateRequestBody {
  serviceId?: number | string;
  timestamp?: number;
  transId?: string;
  params?: UzumParams;
  amount?: number | string;
}

interface UzumConfirmRequestBody {
  serviceId?: number | string;
  timestamp?: number;
  transId?: string;
  paymentSource?: string;
  phone?: string;
  tariff?: string | null;
  processingReferenceNumber?: string | null;
  cardType?: number | null;
}

interface UzumReverseRequestBody {
  serviceId?: number | string;
  timestamp?: number;
  transId?: string;
}

interface UzumStatusRequestBody {
  serviceId?: number | string;
  timestamp?: number;
  transId?: string;
}

interface UzumStoredTx {
  serviceId: number;
  transId: string;
  account: string;
  orderId: string;
  amount: number;
  status: "CREATED" | "CONFIRMED" | "REVERSED";
  transTime: number;
  confirmTime?: number | null;
  reverseTime?: number | null;
  paymentSource?: string | null;
  phone?: string | null;
  tariff?: string | null;
  processingReferenceNumber?: string | null;
  cardType?: number | null;
  data?: Record<string, { value: string }>;
}

function jsonError(
  errorCode: string,
  extra: Record<string, unknown> = {},
  status = 400
) {
  return NextResponse.json(
    {
      status: "FAILED",
      errorCode,
      ...extra,
    },
    { status }
  );
}

function validateBasicAuth(req: NextRequest): boolean {
  const expectedUser = process.env.UZUM_MERCHANT_USERNAME || "uzum_merchant";
  const expectedPass = process.env.UZUM_MERCHANT_PASSWORD || "DomTextil2026Uzum!";

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  const base64Credentials = authHeader.substring("Basic ".length).trim();
  try {
    const decoded = Buffer.from(base64Credentials, "base64").toString("utf-8");
    const [user, ...passParts] = decoded.split(":");
    const pass = passParts.join(":");
    return user === expectedUser && pass === expectedPass;
  } catch {
    return false;
  }
}

function resolveServiceId(bodyServiceId: unknown): number {
  if (typeof bodyServiceId === "number") return bodyServiceId;
  if (typeof bodyServiceId === "string") {
    const parsed = parseInt(bodyServiceId, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const envServiceId = parseInt(process.env.UZUM_SERVICE_ID || "101202", 10);
  return Number.isNaN(envServiceId) ? 101202 : envServiceId;
}

export async function handleUzumWebhook(
  req: NextRequest,
  action: string
): Promise<Response> {
  const normalizedAction = action.toLowerCase().trim();

  // 1. Validate HTTP method
  if (req.method !== "POST") {
    return jsonError("10003");
  }

  // 2. Validate Basic Auth
  if (!validateBasicAuth(req)) {
    return jsonError("10001");
  }

  // 3. Parse JSON Body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("10002");
  }

  if (!rawBody || typeof rawBody !== "object") {
    return jsonError("10002");
  }

  const bodyRecord = rawBody as Record<string, unknown>;
  const serviceId = resolveServiceId(bodyRecord.serviceId);

  // Validate serviceId presence
  if (bodyRecord.serviceId === undefined || bodyRecord.serviceId === null) {
    return jsonError("10005");
  }

  // 4. Route by action
  try {
    switch (normalizedAction) {
      case "check":
        return await handleCheck(bodyRecord as unknown as UzumCheckRequestBody, serviceId);
      case "create":
        return await handleCreate(bodyRecord as unknown as UzumCreateRequestBody, serviceId);
      case "confirm":
        return await handleConfirm(bodyRecord as unknown as UzumConfirmRequestBody, serviceId);
      case "reverse":
        return await handleReverse(bodyRecord as unknown as UzumReverseRequestBody, serviceId);
      case "status":
        return await handleStatus(bodyRecord as unknown as UzumStatusRequestBody, serviceId);
      default:
        return jsonError("10003");
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Uzum Merchant API Error]:", err);
    await writePaymentLog({
      action: `uzum_${normalizedAction}_error`,
      request: rawBody,
      statusCode: 500,
      errorMessage,
    });
    return jsonError("99999", { serviceId, timestamp: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// /check Handler
// ---------------------------------------------------------------------------
async function handleCheck(
  body: UzumCheckRequestBody,
  serviceId: number
): Promise<Response> {
  const timestamp = typeof body.timestamp === "number" ? body.timestamp : Date.now();

  if (!body.params || typeof body.params !== "object") {
    return jsonError("10005", { serviceId, timestamp });
  }

  const account = (
    body.params.account ??
    body.params.order_id ??
    body.params.orderId ??
    body.params.order_number ??
    body.params.orderNumber ??
    ""
  ).toString().trim();

  if (!account) {
    return jsonError("10005", { serviceId, timestamp });
  }

  // Find order in DB
  const order = await findOrder(account);

  if (!order) {
    return jsonError("10007", { serviceId, timestamp });
  }

  // Status checks:
  if (["confirmed", "packing", "shipped", "delivered"].includes(order.status)) {
    return jsonError("10008", { serviceId, timestamp });
  }

  if (["cancelled", "refunded"].includes(order.status)) {
    return jsonError("10009", { serviceId, timestamp });
  }

  const fio = order.user?.name || "Покупатель";
  const amountSum = (Number(order.totalCents) / 100).toFixed(0);

  return NextResponse.json({
    serviceId,
    timestamp: Date.now(),
    status: "OK",
    data: {
      account: { value: order.number },
      fio: { value: fio },
      amount: { value: amountSum },
    },
  });
}

// ---------------------------------------------------------------------------
// /create Handler
// ---------------------------------------------------------------------------
async function handleCreate(
  body: UzumCreateRequestBody,
  serviceId: number
): Promise<Response> {
  const transTime = Date.now();
  const transId = body.transId?.toString().trim();
  const parsedAmount =
    typeof body.amount === "number" ? body.amount : parseInt(String(body.amount), 10);

  if (
    !transId ||
    !body.params ||
    typeof body.params !== "object" ||
    Number.isNaN(parsedAmount)
  ) {
    return jsonError("10005", { serviceId, transId, transTime });
  }

  // 1. Check if transId already exists
  const existingTx = await prisma.webhookEvent.findFirst({
    where: {
      provider: "uzum",
      externalId: transId,
    },
  });

  if (existingTx) {
    return jsonError("10010", { serviceId, transId, transTime });
  }

  // 2. Resolve order
  const account = (
    body.params.account ??
    body.params.order_id ??
    body.params.orderId ??
    body.params.order_number ??
    body.params.orderNumber ??
    ""
  ).toString().trim();

  if (!account) {
    return jsonError("10005", { serviceId, transId, transTime });
  }

  const order = await findOrder(account);
  if (!order) {
    return jsonError("10007", { serviceId, transId, transTime });
  }

  if (["confirmed", "packing", "shipped", "delivered"].includes(order.status)) {
    return jsonError("10008", { serviceId, transId, transTime });
  }

  if (["cancelled", "refunded"].includes(order.status)) {
    return jsonError("10009", { serviceId, transId, transTime });
  }

  // Check amount: totalCents is in tiyins (1 UZS = 100 tiyins)
  if (Number(parsedAmount) !== Number(order.totalCents)) {
    return jsonError("10011", { serviceId, transId, transTime });
  }

  const fio = order.user?.name || "Покупатель";

  // Store transaction in WebhookEvent
  const storedPayload: UzumStoredTx = {
    serviceId,
    transId,
    account: order.number,
    orderId: order.id,
    amount: parsedAmount,
    status: "CREATED",
    transTime,
    data: {
      account: { value: order.number },
      fio: { value: fio },
    },
  };

  await prisma.webhookEvent.create({
    data: {
      provider: "uzum",
      eventType: "create",
      externalId: transId,
      signature: "tx",
      payload: storedPayload as unknown as Prisma.InputJsonValue,
      processed: false,
    },
  });

  await writePaymentLog({
    action: "uzum_create",
    request: body as unknown as Prisma.InputJsonValue,
    statusCode: 200,
  });

  return NextResponse.json({
    serviceId,
    transId,
    status: "CREATED",
    transTime,
    data: {
      account: { value: order.number },
    },
    amount: parsedAmount,
  });
}

// ---------------------------------------------------------------------------
// /confirm Handler
// ---------------------------------------------------------------------------
async function handleConfirm(
  body: UzumConfirmRequestBody,
  serviceId: number
): Promise<Response> {
  const confirmTime = Date.now();
  const transId = body.transId?.toString().trim();

  if (!transId || !body.paymentSource || !body.phone) {
    return jsonError("10005", { serviceId, transId, confirmTime });
  }

  const event = await prisma.webhookEvent.findFirst({
    where: {
      provider: "uzum",
      externalId: transId,
    },
  });

  if (!event) {
    return jsonError("10014", { serviceId, transId, confirmTime });
  }

  const tx = event.payload as unknown as UzumStoredTx;

  if (tx.status === "REVERSED") {
    return jsonError("10015", { serviceId, transId, confirmTime });
  }

  if (tx.status === "CONFIRMED") {
    return jsonError("10016", { serviceId, transId, confirmTime });
  }

  const updatedPayload: UzumStoredTx = {
    ...tx,
    status: "CONFIRMED",
    confirmTime,
    paymentSource: body.paymentSource,
    phone: body.phone,
    tariff: body.tariff ?? null,
    processingReferenceNumber: body.processingReferenceNumber ?? null,
    cardType: body.cardType ?? null,
  };

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      eventType: "confirm",
      payload: updatedPayload as unknown as Prisma.InputJsonValue,
      processed: true,
    },
  });

  if (tx.orderId) {
    await prisma.order.update({
      where: { id: tx.orderId },
      data: { status: "confirmed" },
    });

    await prisma.payment.updateMany({
      where: { orderId: tx.orderId, status: "pending" },
      data: { status: "captured", capturedAt: new Date() },
    });
  }

  await writePaymentLog({
    action: "uzum_confirm",
    request: body as unknown as Prisma.InputJsonValue,
    statusCode: 200,
  });

  return NextResponse.json({
    serviceId,
    transId,
    status: "CONFIRMED",
    confirmTime,
    data: {
      account: { value: tx.account },
    },
    amount: tx.amount,
  });
}

// ---------------------------------------------------------------------------
// /reverse Handler
// ---------------------------------------------------------------------------
async function handleReverse(
  body: UzumReverseRequestBody,
  serviceId: number
): Promise<Response> {
  const reverseTime = Date.now();
  const transId = body.transId?.toString().trim();

  if (!transId) {
    return jsonError("10005", { serviceId, transId, reverseTime });
  }

  const event = await prisma.webhookEvent.findFirst({
    where: {
      provider: "uzum",
      externalId: transId,
    },
  });

  if (!event) {
    return jsonError("10014", { serviceId, transId, reverseTime });
  }

  const tx = event.payload as unknown as UzumStoredTx;

  if (tx.status === "REVERSED") {
    return jsonError("10018", { serviceId, transId, reverseTime });
  }

  const updatedPayload: UzumStoredTx = {
    ...tx,
    status: "REVERSED",
    reverseTime,
  };

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      eventType: "reverse",
      payload: updatedPayload as unknown as Prisma.InputJsonValue,
      processed: true,
    },
  });

  if (tx.orderId) {
    await prisma.order.update({
      where: { id: tx.orderId },
      data: { status: "cancelled" },
    });

    await prisma.payment.updateMany({
      where: { orderId: tx.orderId },
      data: { status: "refunded" },
    });
  }

  await writePaymentLog({
    action: "uzum_reverse",
    request: body as unknown as Prisma.InputJsonValue,
    statusCode: 200,
  });

  return NextResponse.json({
    serviceId,
    transId,
    status: "REVERSED",
    reverseTime,
    data: {
      account: { value: tx.account },
    },
    amount: tx.amount,
  });
}

// ---------------------------------------------------------------------------
// /status Handler
// ---------------------------------------------------------------------------
async function handleStatus(
  body: UzumStatusRequestBody,
  serviceId: number
): Promise<Response> {
  const transId = body.transId?.toString().trim();

  if (!transId) {
    return jsonError("10005", { serviceId, transId });
  }

  const event = await prisma.webhookEvent.findFirst({
    where: {
      provider: "uzum",
      externalId: transId,
    },
  });

  if (!event) {
    return jsonError("10014", { serviceId, transId });
  }

  const tx = event.payload as unknown as UzumStoredTx;

  return NextResponse.json({
    serviceId,
    transId,
    status: tx.status,
    transTime: tx.transTime,
    confirmTime: tx.confirmTime ?? null,
    reverseTime: tx.reverseTime ?? null,
    data: {
      account: { value: tx.account },
    },
    amount: tx.amount,
  });
}

// ---------------------------------------------------------------------------
// Helper: findOrder
// ---------------------------------------------------------------------------
async function findOrder(account: string) {
  // Aliases for testing / mock accounts
  if (
    account === "123456789" ||
    account === "123123" ||
    account.toUpperCase() === "TEST" ||
    account.toUpperCase() === "TEST-ORDER"
  ) {
    const testOrder = await prisma.order.findFirst({
      where: { number: "BGX-UZUM-TEST" },
      include: { user: true, payments: true },
    });
    if (testOrder) return testOrder;
  }

  // Try exact number
  let order = await prisma.order.findUnique({
    where: { number: account },
    include: { user: true, payments: true },
  });

  if (order) return order;

  // Try exact id
  order = await prisma.order.findUnique({
    where: { id: account },
    include: { user: true, payments: true },
  });

  if (order) return order;

  // Try endsWith number
  order = await prisma.order.findFirst({
    where: { number: { endsWith: account } },
    include: { user: true, payments: true },
  });

  return order;
}
