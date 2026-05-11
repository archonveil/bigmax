/**
 * Чистые helpers для Uniteller mock-server'а (P4-T12).
 *
 * Файл специально без side-effects (нет `createServer` / `listen`), чтобы
 * vitest мог импортировать функции в `mock-helpers.test.ts` без поднятия
 * порта 8787. HTTP-сервер живёт в `mock-server.ts` и переиспользует эти
 * функции.
 *
 * Логика, повторяющая боевой Uniteller:
 *   - **Verify form signature** — валидация `Signature` в POST /pay/. Mock
 *     отказывает на 400 если подпись не совпадает (защита от случайной
 *     отправки в прод-конфиге Shop_IDP без правильного password).
 *   - **Compute callback signature** — генерируется при auto-callback'е на
 *     наш webhook (используется `computeCallbackSignature` из `signature.ts`).
 *   - **State machine** — карта `Order_IDP → MockOrderState`; обновляется на
 *     /pay/, /cancel/ и /admin/state/. Используется в /results/ для XML.
 *   - **Test modes** — `?test=success|fail|timeout|double` определяет
 *     поведение mock'а после получения /pay/. По-умолчанию `success`.
 */

import { buildSignature, computeCallbackSignature } from "./signature";

// ---------------------------------------------------------------------------
// Test modes
// ---------------------------------------------------------------------------

export const MOCK_TEST_MODES = ["success", "fail", "timeout", "double"] as const;
export type MockTestMode = (typeof MOCK_TEST_MODES)[number];

export function parseTestMode(raw: string | null): MockTestMode {
  if (raw === null || raw === "") return "success";
  return (MOCK_TEST_MODES as readonly string[]).includes(raw) ? (raw as MockTestMode) : "success";
}

// ---------------------------------------------------------------------------
// Form signature verification (POST /pay/)
// ---------------------------------------------------------------------------

export interface VerifyPayFormInput {
  shopId: string;
  orderId: string;
  subtotal: string;
  signature: string;
  password: string;
}

export type VerifyPayFormResult =
  | { ok: true }
  | { ok: false; reason: "missing_field" | "signature_mismatch" };

/**
 * Проверяет валидность POST /pay/ формы как делал бы Uniteller. Возвращает
 * discriminated-union — caller решает что отдать в HTTP (400 vs 200).
 */
export function verifyPayForm(input: VerifyPayFormInput): VerifyPayFormResult {
  if (
    input.shopId === "" ||
    input.orderId === "" ||
    input.subtotal === "" ||
    input.signature === "" ||
    input.password === ""
  ) {
    return { ok: false, reason: "missing_field" };
  }
  const expected = buildSignature({
    shopId: input.shopId,
    orderId: input.orderId,
    subtotal: input.subtotal,
    password: input.password,
  });
  if (expected !== input.signature.toUpperCase()) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Callback body builder
// ---------------------------------------------------------------------------

export type MockCallbackStatus = "Authorized" | "NotAuthorized";

export interface BuildCallbackBodyInput {
  orderId: string;
  status: MockCallbackStatus;
  password: string;
  /** RRN (Billnumber). Mock-генерация — `MOCK-<timestamp>`. */
  billnumber: string;
  /** Маска карты, например "4000 **** **** 2487". */
  cardMask: string;
}

/**
 * Генерирует form-encoded body callback'а Uniteller. Подпись считаем тем же
 * `computeCallbackSignature`, что использует и production-webhook — это
 * гарантирует, что mock не разъедется с реальным алгоритмом проверки.
 */
export function buildCallbackBody(input: BuildCallbackBodyInput): string {
  const sig = computeCallbackSignature(input.orderId, input.status, input.password);
  return new URLSearchParams({
    Order_ID: input.orderId,
    Status: input.status,
    Signature: sig,
    Billnumber: input.billnumber,
    Response_Code: input.status === "Authorized" ? "00" : "05",
    CardNumber: input.cardMask,
  }).toString();
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type MockOrderStatus = "Authorized" | "Paid" | "NotAuthorized" | "Canceled" | "Waiting";

export interface MockOrderState {
  orderId: string;
  status: MockOrderStatus;
  subtotal: string;
  billnumber: string;
  cardMask: string;
  /** Сколько callback'ов было отправлено — для test=double и идемпотентности. */
  callbacksSent: number;
  /** Какие mode-флаги установлены. Используется /admin/timeout. */
  callbackBlocked: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MockState = Map<string, MockOrderState>;

export function createState(): MockState {
  return new Map();
}

export function upsertOrder(
  state: MockState,
  orderId: string,
  data: Pick<MockOrderState, "status" | "subtotal" | "billnumber" | "cardMask">,
): MockOrderState {
  const now = Date.now();
  const existing = state.get(orderId);
  const next: MockOrderState = existing
    ? { ...existing, ...data, updatedAt: now }
    : {
        orderId,
        status: data.status,
        subtotal: data.subtotal,
        billnumber: data.billnumber,
        cardMask: data.cardMask,
        callbacksSent: 0,
        callbackBlocked: false,
        createdAt: now,
        updatedAt: now,
      };
  state.set(orderId, next);
  return next;
}

export function setOrderStatus(
  state: MockState,
  orderId: string,
  status: MockOrderStatus,
): MockOrderState | null {
  const existing = state.get(orderId);
  if (!existing) return null;
  const next: MockOrderState = { ...existing, status, updatedAt: Date.now() };
  state.set(orderId, next);
  return next;
}

export function blockCallback(state: MockState, orderId: string): boolean {
  const existing = state.get(orderId);
  if (!existing) return false;
  state.set(orderId, { ...existing, callbackBlocked: true, updatedAt: Date.now() });
  return true;
}

export function recordCallbackSent(state: MockState, orderId: string): number {
  const existing = state.get(orderId);
  if (!existing) return 0;
  const next: MockOrderState = {
    ...existing,
    callbacksSent: existing.callbacksSent + 1,
    updatedAt: Date.now(),
  };
  state.set(orderId, next);
  return next.callbacksSent;
}

// ---------------------------------------------------------------------------
// XML response (/results/)
// ---------------------------------------------------------------------------

export function renderResultsXml(orders: MockOrderState[]): string {
  const items = orders
    .map(
      (o) => `  <order>
    <orderid>${escapeXml(o.orderId)}</orderid>
    <status>${o.status}</status>
    <total>${escapeXml(o.subtotal)}</total>
    <billnumber>${escapeXml(o.billnumber)}</billnumber>
    <approvalcode>${o.status === "Authorized" || o.status === "Paid" ? "00" : "05"}</approvalcode>
    <lastmodified>${formatLastModified(o.updatedAt)}</lastmodified>
  </order>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<orders>
${items}
</orders>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLastModified(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// ---------------------------------------------------------------------------
// Decision tree: что делает mock после успешного POST /pay/
// ---------------------------------------------------------------------------

export interface PayDecisionInput {
  mode: MockTestMode;
  returnOkUrl: string;
  returnNoUrl: string;
  returnUrl: string;
}

export type PayDecision =
  | { kind: "callback_then_redirect"; status: MockCallbackStatus; times: 1 | 2; redirectTo: string }
  | { kind: "no_callback_redirect"; redirectTo: string };

/**
 * Чистая функция: на вход — режим теста и URL'ы из формы, на выход —
 * план действий mock'а. Используется и в http-handler'е, и в unit-тестах.
 */
export function decidePayAction(input: PayDecisionInput): PayDecision {
  switch (input.mode) {
    case "success":
      return {
        kind: "callback_then_redirect",
        status: "Authorized",
        times: 1,
        redirectTo: input.returnOkUrl,
      };
    case "fail":
      return {
        kind: "callback_then_redirect",
        status: "NotAuthorized",
        times: 1,
        redirectTo: input.returnNoUrl,
      };
    case "double":
      return {
        kind: "callback_then_redirect",
        status: "Authorized",
        times: 2,
        redirectTo: input.returnOkUrl,
      };
    case "timeout":
      return { kind: "no_callback_redirect", redirectTo: input.returnUrl };
  }
}
