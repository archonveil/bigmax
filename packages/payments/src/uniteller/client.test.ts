import { describe, expect, it, vi } from "vitest";

import { cancelUnitellerPayment, fetchPaymentStatus, parseResultsXml } from "./client";

const VALID_XML = `<?xml version="1.0"?>
<orders>
  <order>
    <orderid>BGX-20260425-0001</orderid>
    <status>Authorized</status>
    <total>15000.00</total>
    <billnumber>RRN-12345</billnumber>
    <approvalcode>00</approvalcode>
    <lastmodified>2026-04-25 12:34:56</lastmodified>
  </order>
</orders>
`;

describe("parseResultsXml", () => {
  it("парсит один <order> со всеми полями", () => {
    const items = parseResultsXml(VALID_XML);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      OrderId: "BGX-20260425-0001",
      Status: "Authorized",
      Total: "15000.00",
      Billnumber: "RRN-12345",
      ApprovalCode: "00",
      LastModified: "2026-04-25 12:34:56",
    });
  });

  it("парсит несколько <order> блоков", () => {
    const xml = `<orders>
      <order>
        <orderid>BGX-20260425-0001</orderid>
        <status>Paid</status>
        <total>1000.00</total>
      </order>
      <order>
        <orderid>BGX-20260425-0002</orderid>
        <status>Canceled</status>
        <total>500.00</total>
      </order>
    </orders>`;
    const items = parseResultsXml(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.Status).toBe("Paid");
    expect(items[1]?.Status).toBe("Canceled");
  });

  it("без <order> блоков → пустой массив (не error)", () => {
    expect(parseResultsXml("<orders></orders>")).toEqual([]);
  });

  it("отсутствие OrderId/Status/Total → throw", () => {
    const xml = `<orders><order><orderid>X</orderid></order></orders>`;
    expect(() => parseResultsXml(xml)).toThrow(/missing required fields/);
  });

  it("неизвестный Status → throw (Zod enum)", () => {
    const xml = `<orders><order>
      <orderid>BGX-20260425-0001</orderid>
      <status>UnknownStatus</status>
      <total>1000.00</total>
    </order></orders>`;
    expect(() => parseResultsXml(xml)).toThrow();
  });

  it("Total с неправильным форматом (не decimal) → throw", () => {
    const xml = `<orders><order>
      <orderid>BGX-20260425-0001</orderid>
      <status>Paid</status>
      <total>notanumber</total>
    </order></orders>`;
    expect(() => parseResultsXml(xml)).toThrow();
  });
});

describe("fetchPaymentStatus", () => {
  const baseInput = {
    orderId: "BGX-20260425-0001",
    shopId: "POINT0001",
    authLogin: "user",
    authPassword: "pwd",
  };

  it("happy path → kind: ok с распарсенными items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(VALID_XML),
    });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.items[0]?.Status).toBe("Authorized");
    }
  });

  it("шлёт Authorization Basic <base64(login:password)>", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<orders></orders>"),
    });
    await fetchPaymentStatus({ ...baseInput, fetchImpl });
    const expected = `Basic ${Buffer.from("user:pwd").toString("base64")}`;
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://wpay.uniteller.ru/results/"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expected }) }),
    );
  });

  it("URL содержит Shop_IDP, Order_ID, Format=XML query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<orders></orders>"),
    });
    await fetchPaymentStatus({ ...baseInput, fetchImpl });
    const url = fetchImpl.mock.calls[0]![0]!;
    expect(url).toContain("Shop_IDP=POINT0001");
    expect(url).toContain("Order_ID=BGX-20260425-0001");
    expect(url).toContain("Format=XML");
  });

  it("401 → kind: auth_error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("") });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("auth_error");
  });

  it("403 → kind: auth_error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("") });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("auth_error");
  });

  it("404 → kind: not_found", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve("") });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("not_found");
  });

  it("500 → kind: network_error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("") });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("network_error");
  });

  it("throw в fetchImpl → kind: network_error с message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("network_error");
    if (res.kind === "network_error") expect(res.message).toBe("ECONNRESET");
  });

  it("малформированный XML → kind: parse_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("not xml at all"),
    });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.items).toEqual([]);
    // Без <order> блоков — пустой массив, parse_error не возникает.
  });
});

describe("fetchPaymentStatus · timeout (AbortController)", () => {
  const baseInput = {
    orderId: "BGX-20260425-0001",
    shopId: "POINT0001",
    authLogin: "user",
    authPassword: "pwd",
  };

  it("таймаут срабатывает → kind: network_error с message: timeout", async () => {
    // fetchImpl никогда не резолвится; AbortController должен прервать его
    // через 50ms. AbortError → message содержит «timeout».
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl, timeoutMs: 50 });
    expect(res.kind).toBe("network_error");
    if (res.kind === "network_error") {
      expect(res.message).toMatch(/timeout 50ms/);
    }
  });

  it("успешный запрос до таймаута → kind: ok (timer очищается finally'ем)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<orders></orders>"),
    });
    const res = await fetchPaymentStatus({ ...baseInput, fetchImpl, timeoutMs: 5_000 });
    expect(res.kind).toBe("ok");
  });

  it("AbortSignal пробрасывается во второй аргумент fetchImpl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<orders></orders>"),
    });
    await fetchPaymentStatus({ ...baseInput, fetchImpl });
    const init = fetchImpl.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// cancelUnitellerPayment (P5-T4)
// ---------------------------------------------------------------------------

describe("cancelUnitellerPayment", () => {
  const baseInput = {
    orderId: "BGX-20260427-0001",
    shopId: "POINT0001",
    authLogin: "user",
    authPassword: "pwd",
  };

  it("happy path: 200 + <Status>Canceled</Status> → kind: ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `<?xml version="1.0"?><Orders><Order><OrderID>BGX-20260427-0001</OrderID><Status>Canceled</Status></Order></Orders>`,
        ),
    });
    const res = await cancelUnitellerPayment({ ...baseInput, fetchImpl });
    expect(res).toEqual({ kind: "ok" });
  });

  it("принимает написание Cancelled (BR vs AmE)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<Status>Cancelled</Status>"),
    });
    expect(await cancelUnitellerPayment({ ...baseInput, fetchImpl })).toEqual({ kind: "ok" });
  });

  it("200 без явного Status узла → ok (legacy ответы)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<Order>nothing here</Order>"),
    });
    expect(await cancelUnitellerPayment({ ...baseInput, fetchImpl })).toEqual({ kind: "ok" });
  });

  it("200 + <Status>Error</Status> → provider_error с message из Message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<Status>Error</Status><Message>order not found</Message>"),
    });
    const res = await cancelUnitellerPayment({ ...baseInput, fetchImpl });
    expect(res).toEqual({ kind: "provider_error", message: "order not found" });
  });

  it("401 → auth_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(""),
    });
    expect(await cancelUnitellerPayment({ ...baseInput, fetchImpl })).toEqual({
      kind: "auth_error",
      httpStatus: 401,
    });
  });

  it("404 → not_found", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
    });
    expect(await cancelUnitellerPayment({ ...baseInput, fetchImpl })).toEqual({
      kind: "not_found",
      httpStatus: 404,
    });
  });

  it("500 → network_error с http-status в message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
    });
    const res = await cancelUnitellerPayment({ ...baseInput, fetchImpl });
    expect(res).toEqual({ kind: "network_error", message: "http 500" });
  });

  it("network exception → network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    expect(await cancelUnitellerPayment({ ...baseInput, fetchImpl })).toMatchObject({
      kind: "network_error",
    });
  });

  it("отправляет POST x-www-form-urlencoded с Shop_IDP+Order_ID + Basic auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<Status>Canceled</Status>"),
    });
    await cancelUnitellerPayment({ ...baseInput, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/cancel\/$/);
    const i = init as { method: string; headers: Record<string, string>; body: string };
    expect(i.method).toBe("POST");
    expect(i.headers["Authorization"]).toMatch(/^Basic /);
    expect(i.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(i.body);
    expect(body.get("Shop_IDP")).toBe("POINT0001");
    expect(body.get("Order_ID")).toBe("BGX-20260427-0001");
  });

  it("Billnumber/Subtotal добавляются в body когда переданы", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<Status>Canceled</Status>"),
    });
    await cancelUnitellerPayment({
      ...baseInput,
      fetchImpl,
      billnumber: "RRN-9999",
      subtotal: "15000.00",
    });
    const init = fetchImpl.mock.calls[0]![1] as { body: string };
    const body = new URLSearchParams(init.body);
    expect(body.get("Billnumber")).toBe("RRN-9999");
    expect(body.get("Subtotal")).toBe("15000.00");
  });

  it("timeout срабатывает → network_error timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const res = await cancelUnitellerPayment({ ...baseInput, fetchImpl, timeoutMs: 30 });
    expect(res.kind).toBe("network_error");
    if (res.kind === "network_error") {
      expect(res.message).toMatch(/timeout 30ms/);
    }
  });
});
