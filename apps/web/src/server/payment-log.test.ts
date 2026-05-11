/**
 * P4-T11: writePaymentLog должен:
 *   - Scrub'ить request/response через `scrubPaymentPayload` (PAN +
 *     секретные ключи) до записи в БД.
 *   - НЕ кидать exception, если prisma упадёт (best-effort).
 *   - Передавать paymentId/action/statusCode/errorMessage прозрачно.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@bigmax/db", () => ({
  prisma: { paymentLog: { create } },
  Prisma: {},
}));

vi.mock("./observability", () => ({
  reportError: vi.fn(),
}));

describe("writePaymentLog", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: "log_1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("scrub'ит CardNumber и Signature перед записью", async () => {
    const { writePaymentLog } = await import("./payment-log");
    await writePaymentLog({
      paymentId: "p_1",
      action: "webhook",
      request: {
        Order_ID: "BGX-20260427-0001",
        CardNumber: "4000 1234 5678 2487",
        Signature: "DEADBEEF",
      },
      statusCode: 200,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]![0];
    expect(args.data.paymentId).toBe("p_1");
    expect(args.data.action).toBe("webhook");
    expect(args.data.statusCode).toBe(200);
    expect(args.data.request).toMatchObject({
      Order_ID: "BGX-20260427-0001",
      CardNumber: "**** **** **** 2487",
      Signature: "[REDACTED]",
    });
  });

  it("scrub'ит response payload тоже", async () => {
    const { writePaymentLog } = await import("./payment-log");
    await writePaymentLog({
      paymentId: "p_2",
      action: "create_uniteller",
      response: {
        fields: { Signature: "ABC", CardNumber: "5500 9988 7766 5544" },
      },
      statusCode: 200,
    });

    const args = create.mock.calls[0]![0];
    expect(args.data.response).toEqual({
      fields: { Signature: "[REDACTED]", CardNumber: "**** **** **** 5544" },
    });
  });

  it("не throw'ит когда prisma падает (best-effort)", async () => {
    create.mockRejectedValue(new Error("connection refused"));
    const { writePaymentLog } = await import("./payment-log");
    await expect(
      writePaymentLog({ action: "webhook_internal_error", statusCode: 500 }),
    ).resolves.toBeUndefined();
  });

  it("опускает paymentId если null/undefined", async () => {
    const { writePaymentLog } = await import("./payment-log");
    await writePaymentLog({
      action: "webhook_invalid_signature",
      statusCode: 401,
      errorMessage: "signature mismatch",
    });

    const args = create.mock.calls[0]![0];
    expect(args.data.paymentId).toBeUndefined();
    expect(args.data.action).toBe("webhook_invalid_signature");
    expect(args.data.errorMessage).toBe("signature mismatch");
  });
});
