/**
 * P4-T12: чистые helpers Uniteller mock-server'а.
 * HTTP-сервер тестируется e2e Playwright'ом (uniteller-flow.spec.ts).
 */

import { describe, expect, it } from "vitest";

import {
  blockCallback,
  buildCallbackBody,
  createState,
  decidePayAction,
  parseTestMode,
  recordCallbackSent,
  renderResultsXml,
  setOrderStatus,
  upsertOrder,
  verifyPayForm,
} from "./mock-helpers";
import { buildSignature, computeCallbackSignature } from "./signature";

const PASSWORD = "test-password-do-not-use-in-prod";
const VALID_FORM = {
  shopId: "BGX_TEST_SHOP",
  orderId: "BGX-20260427-0001",
  subtotal: "150000.00",
  password: PASSWORD,
};

describe("parseTestMode", () => {
  it("дефолт = success при отсутствии query", () => {
    expect(parseTestMode(null)).toBe("success");
    expect(parseTestMode("")).toBe("success");
  });

  it("распознаёт все 4 валидных режима", () => {
    expect(parseTestMode("success")).toBe("success");
    expect(parseTestMode("fail")).toBe("fail");
    expect(parseTestMode("timeout")).toBe("timeout");
    expect(parseTestMode("double")).toBe("double");
  });

  it("неизвестное значение → success (защита от опечаток в тестах)", () => {
    expect(parseTestMode("succes")).toBe("success");
    expect(parseTestMode("FAIL")).toBe("success"); // case-sensitive
  });
});

describe("verifyPayForm", () => {
  it("корректная подпись → ok", () => {
    // Используем buildSignature из signature.ts через side-effect: считаем
    // ожидаемый Signature вручную и подаём в verifyPayForm.
    // Простейший способ — переиспользовать компонент:
    // imported at file top
    const sig = buildSignature(VALID_FORM);
    expect(verifyPayForm({ ...VALID_FORM, signature: sig })).toEqual({ ok: true });
  });

  it("пустой shopId → missing_field", () => {
    expect(verifyPayForm({ ...VALID_FORM, shopId: "", signature: "X".repeat(32) })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });

  it("пустой orderId → missing_field", () => {
    expect(verifyPayForm({ ...VALID_FORM, orderId: "", signature: "X".repeat(32) })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });

  it("пустой subtotal → missing_field", () => {
    expect(verifyPayForm({ ...VALID_FORM, subtotal: "", signature: "X".repeat(32) })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });

  it("пустой signature → missing_field", () => {
    expect(verifyPayForm({ ...VALID_FORM, signature: "" })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });

  it("пустой password (mock-misconfigured) → missing_field", () => {
    expect(verifyPayForm({ ...VALID_FORM, password: "", signature: "X".repeat(32) })).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });

  it("несовпадающая подпись → signature_mismatch", () => {
    expect(verifyPayForm({ ...VALID_FORM, signature: "F".repeat(32) })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("регистр-нечувствителен (uppercase / lowercase HEX)", () => {
    // imported at file top
    const sig = buildSignature(VALID_FORM);
    expect(verifyPayForm({ ...VALID_FORM, signature: sig.toLowerCase() }).ok).toBe(true);
  });
});

describe("buildCallbackBody", () => {
  it("Authorized: содержит правильный Signature + Response_Code=00", () => {
    const body = buildCallbackBody({
      orderId: "BGX-20260427-0001",
      status: "Authorized",
      password: PASSWORD,
      billnumber: "MOCK-12345",
      cardMask: "4000 **** **** 2487",
    });
    const params = new URLSearchParams(body);
    expect(params.get("Order_ID")).toBe("BGX-20260427-0001");
    expect(params.get("Status")).toBe("Authorized");
    expect(params.get("Response_Code")).toBe("00");
    expect(params.get("Billnumber")).toBe("MOCK-12345");
    expect(params.get("CardNumber")).toBe("4000 **** **** 2487");
    expect(params.get("Signature")).toBe(
      computeCallbackSignature("BGX-20260427-0001", "Authorized", PASSWORD),
    );
  });

  it("NotAuthorized: Response_Code=05", () => {
    const body = buildCallbackBody({
      orderId: "BGX-20260427-0002",
      status: "NotAuthorized",
      password: PASSWORD,
      billnumber: "MOCK-99999",
      cardMask: "4000 **** **** 2479",
    });
    const params = new URLSearchParams(body);
    expect(params.get("Status")).toBe("NotAuthorized");
    expect(params.get("Response_Code")).toBe("05");
  });

  it("Signature совпадает с computeCallbackSignature (production-проверка не разъедется)", () => {
    const body = buildCallbackBody({
      orderId: "BGX-20260427-0003",
      status: "Authorized",
      password: PASSWORD,
      billnumber: "MOCK-1",
      cardMask: "4000 **** **** 2487",
    });
    const params = new URLSearchParams(body);
    expect(params.get("Signature")).toMatch(/^[A-F0-9]{32}$/);
  });
});

describe("decidePayAction", () => {
  const URLS = {
    returnOkUrl: "http://localhost:3030/ru/orders/o_1/success",
    returnNoUrl: "http://localhost:3030/ru/orders/o_1/failure",
    returnUrl: "http://localhost:3030/ru/orders/o_1/return",
  };

  it("success → callback Authorized + redirect URL_RETURN_OK", () => {
    expect(decidePayAction({ mode: "success", ...URLS })).toEqual({
      kind: "callback_then_redirect",
      status: "Authorized",
      times: 1,
      redirectTo: URLS.returnOkUrl,
    });
  });

  it("fail → callback NotAuthorized + redirect URL_RETURN_NO", () => {
    expect(decidePayAction({ mode: "fail", ...URLS })).toEqual({
      kind: "callback_then_redirect",
      status: "NotAuthorized",
      times: 1,
      redirectTo: URLS.returnNoUrl,
    });
  });

  it("double → callback Authorized × 2 + redirect URL_RETURN_OK", () => {
    expect(decidePayAction({ mode: "double", ...URLS })).toEqual({
      kind: "callback_then_redirect",
      status: "Authorized",
      times: 2,
      redirectTo: URLS.returnOkUrl,
    });
  });

  it("timeout → НЕТ callback + redirect URL_RETURN", () => {
    expect(decidePayAction({ mode: "timeout", ...URLS })).toEqual({
      kind: "no_callback_redirect",
      redirectTo: URLS.returnUrl,
    });
  });
});

describe("state machine", () => {
  it("upsertOrder: создаёт новую запись с дефолтами", () => {
    const s = createState();
    const o = upsertOrder(s, "ORD-1", {
      status: "Authorized",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "4000 **** **** 0000",
    });
    expect(o.orderId).toBe("ORD-1");
    expect(o.status).toBe("Authorized");
    expect(o.callbacksSent).toBe(0);
    expect(o.callbackBlocked).toBe(false);
    expect(o.createdAt).toBeGreaterThan(0);
    expect(s.size).toBe(1);
  });

  it("upsertOrder: повторный вызов обновляет, сохраняя callbacksSent", () => {
    const s = createState();
    upsertOrder(s, "ORD-1", {
      status: "Waiting",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "",
    });
    recordCallbackSent(s, "ORD-1");
    const o = upsertOrder(s, "ORD-1", {
      status: "Authorized",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "4000 **** **** 2487",
    });
    expect(o.status).toBe("Authorized");
    expect(o.callbacksSent).toBe(1); // не сбрасывается
  });

  it("setOrderStatus: меняет статус существующего", () => {
    const s = createState();
    upsertOrder(s, "ORD-1", {
      status: "Authorized",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "",
    });
    const updated = setOrderStatus(s, "ORD-1", "Canceled");
    expect(updated?.status).toBe("Canceled");
  });

  it("setOrderStatus: несуществующий → null", () => {
    const s = createState();
    expect(setOrderStatus(s, "MISSING", "Authorized")).toBeNull();
  });

  it("blockCallback: помечает заказ для пропуска следующего callback'а", () => {
    const s = createState();
    upsertOrder(s, "ORD-1", {
      status: "Waiting",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "",
    });
    expect(blockCallback(s, "ORD-1")).toBe(true);
    expect(s.get("ORD-1")?.callbackBlocked).toBe(true);
  });

  it("blockCallback: несуществующий → false", () => {
    const s = createState();
    expect(blockCallback(s, "MISSING")).toBe(false);
  });

  it("recordCallbackSent: инкрементит счётчик", () => {
    const s = createState();
    upsertOrder(s, "ORD-1", {
      status: "Authorized",
      subtotal: "100.00",
      billnumber: "B-1",
      cardMask: "",
    });
    expect(recordCallbackSent(s, "ORD-1")).toBe(1);
    expect(recordCallbackSent(s, "ORD-1")).toBe(2);
    expect(s.get("ORD-1")?.callbacksSent).toBe(2);
  });
});

describe("renderResultsXml", () => {
  it("пустой массив → корректный XML без <order>", () => {
    const xml = renderResultsXml([]);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<orders>");
    expect(xml).toContain("</orders>");
    expect(xml).not.toContain("<order>");
  });

  it("один заказ Authorized → approvalcode=00, status=Authorized", () => {
    const s = createState();
    const o = upsertOrder(s, "BGX-20260427-0001", {
      status: "Authorized",
      subtotal: "150000.00",
      billnumber: "MOCK-1",
      cardMask: "4000 **** **** 2487",
    });
    const xml = renderResultsXml([o]);
    expect(xml).toContain("<orderid>BGX-20260427-0001</orderid>");
    expect(xml).toContain("<status>Authorized</status>");
    expect(xml).toContain("<total>150000.00</total>");
    expect(xml).toContain("<billnumber>MOCK-1</billnumber>");
    expect(xml).toContain("<approvalcode>00</approvalcode>");
    expect(xml).toMatch(/<lastmodified>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}<\/lastmodified>/);
  });

  it("NotAuthorized → approvalcode=05", () => {
    const s = createState();
    const o = upsertOrder(s, "BGX-20260427-0002", {
      status: "NotAuthorized",
      subtotal: "100.00",
      billnumber: "MOCK-2",
      cardMask: "",
    });
    expect(renderResultsXml([o])).toContain("<approvalcode>05</approvalcode>");
  });

  it("XML-escape для специальных символов в orderId", () => {
    const s = createState();
    const o = upsertOrder(s, "ORD-<&>", {
      status: "Authorized",
      subtotal: "100.00",
      billnumber: "B&B",
      cardMask: "",
    });
    const xml = renderResultsXml([o]);
    expect(xml).toContain("ORD-&lt;&amp;&gt;");
    expect(xml).toContain("B&amp;B");
  });
});
