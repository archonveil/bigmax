import { uniteller } from "@bigmax/payments";
import { describe, expect, it } from "vitest";

import { evaluateCallback, parseCallbackBody } from "./uniteller-callback";

const PASSWORD = "test-password";
const VALID_PAYLOAD = {
  Order_ID: "BGX-20260424-0001",
  Status: "Authorized",
  Billnumber: "RRN-12345",
  Response_Code: "00",
};

function withSignature(payload: Record<string, string>): Record<string, string> {
  const sig = uniteller.computeCallbackSignature(
    payload["Order_ID"]!,
    payload["Status"]!,
    PASSWORD,
  );
  return { ...payload, Signature: sig };
}

describe("parseCallbackBody", () => {
  it("парсит form-urlencoded в плоский объект", () => {
    const text = "Order_ID=BGX-20260424-0001&Status=Authorized&Signature=ABCDEF";
    expect(parseCallbackBody(text)).toEqual({
      Order_ID: "BGX-20260424-0001",
      Status: "Authorized",
      Signature: "ABCDEF",
    });
  });

  it("декодирует %-escapes и + (пробелы)", () => {
    const text = "Comment=hello%20world&Card=4000+****+****+2487";
    const parsed = parseCallbackBody(text);
    expect(parsed["Comment"]).toBe("hello world");
    expect(parsed["Card"]).toBe("4000 **** **** 2487");
  });

  it("пустое тело → пустой объект", () => {
    expect(parseCallbackBody("")).toEqual({});
  });
});

describe("evaluateCallback · valid", () => {
  it("принимает корректный payload + подпись → kind: valid", () => {
    const raw = withSignature(VALID_PAYLOAD);
    const decision = evaluateCallback({ raw, password: PASSWORD });
    expect(decision.kind).toBe("valid");
    if (decision.kind === "valid") {
      expect(decision.payload.Order_ID).toBe("BGX-20260424-0001");
      expect(decision.payload.Status).toBe("Authorized");
    }
  });
});

describe("evaluateCallback · invalid_signature", () => {
  it("отвергает подпись от другого password", () => {
    const raw = withSignature(VALID_PAYLOAD);
    const decision = evaluateCallback({ raw, password: "WRONG_PASSWORD" });
    expect(decision.kind).toBe("invalid_signature");
  });

  it("отвергает подделанный Status (подпись не пересчитана)", () => {
    const raw = { ...withSignature(VALID_PAYLOAD), Status: "Paid" };
    const decision = evaluateCallback({ raw, password: PASSWORD });
    expect(decision.kind).toBe("invalid_signature");
  });

  it("отвергает подделанный Order_ID", () => {
    const raw = { ...withSignature(VALID_PAYLOAD), Order_ID: "BGX-20260424-9999" };
    const decision = evaluateCallback({ raw, password: PASSWORD });
    expect(decision.kind).toBe("invalid_signature");
  });
});

describe("evaluateCallback · invalid_payload", () => {
  it("без Order_ID → invalid_payload", () => {
    const decision = evaluateCallback({
      raw: { Status: "Authorized", Signature: "X".repeat(32) },
      password: PASSWORD,
    });
    expect(decision.kind).toBe("invalid_payload");
  });

  it("с неизвестным Status → invalid_payload (Zod enum)", () => {
    const raw = {
      Order_ID: "BGX-20260424-0001",
      Status: "NotAValidStatus",
      Signature: "X".repeat(32),
    };
    const decision = evaluateCallback({ raw, password: PASSWORD });
    expect(decision.kind).toBe("invalid_payload");
  });

  it("без Signature → invalid_payload", () => {
    const decision = evaluateCallback({
      raw: { Order_ID: "BGX-20260424-0001", Status: "Authorized" },
      password: PASSWORD,
    });
    expect(decision.kind).toBe("invalid_payload");
  });
});

describe("evaluateCallback · все Uniteller-статусы принимаются как valid", () => {
  it.each(["Authorized", "Paid", "Canceled", "NotAuthorized", "Waiting"])(
    "Status=%s → kind: valid",
    (status) => {
      const raw = withSignature({ ...VALID_PAYLOAD, Status: status });
      const decision = evaluateCallback({ raw, password: PASSWORD });
      expect(decision.kind).toBe("valid");
    },
  );
});
