import { describe, expect, it } from "vitest";

import { maskCardNumber, REDACTED, scrubPaymentPayload } from "./mask";

describe("maskCardNumber · базовые форматы", () => {
  it("16-digit PAN с пробелами → маскирует первые 12, last4", () => {
    expect(maskCardNumber("4000 1234 5678 2487")).toBe("**** **** **** 2487");
  });

  it("16-digit PAN с дефисами → сохраняет separators", () => {
    expect(maskCardNumber("4000-1234-5678-2487")).toBe("****-****-****-2487");
  });

  it("16-digit PAN сплошной → масками заменяет digit'ы", () => {
    expect(maskCardNumber("4000123456782487")).toBe("************2487");
  });

  it("15-digit PAN (Amex)", () => {
    expect(maskCardNumber("3782 822463 10005")).toBe("**** ****** *0005");
  });

  it("13-digit (минимальный PAN)", () => {
    expect(maskCardNumber("4000123412341")).toBe("*********2341");
  });

  it("19-digit (максимальный)", () => {
    expect(maskCardNumber("4000123456789012345")).toBe("***************2345");
  });
});

describe("maskCardNumber · идемпотентность для уже-маскированных", () => {
  it("Uniteller-формат `4000 **** **** 2487` не трогается", () => {
    expect(maskCardNumber("4000 **** **** 2487")).toBe("4000 **** **** 2487");
  });

  it("повторное применение не меняет результат", () => {
    const once = maskCardNumber("4000 1234 5678 2487");
    const twice = maskCardNumber(once);
    expect(twice).toBe(once);
  });
});

describe("maskCardNumber · НЕ трогает не-PAN", () => {
  it("короткие числа (12 или меньше)", () => {
    expect(maskCardNumber("123456789012")).toBe("123456789012");
  });

  it("слишком длинные (20+) не считаем PAN'ом", () => {
    expect(maskCardNumber("12345678901234567890")).toBe("12345678901234567890");
  });

  it("телефон +998 90 123-45-67 не задевается (не 13-19 digits подряд)", () => {
    expect(maskCardNumber("+998 90 123-45-67")).toBe("+998 90 123-45-67");
  });

  it("нечисловые строки", () => {
    expect(maskCardNumber("Hello, world!")).toBe("Hello, world!");
  });

  it("Order_ID `BGX-20260427-0001` не задевается", () => {
    expect(maskCardNumber("BGX-20260427-0001")).toBe("BGX-20260427-0001");
  });
});

describe("maskCardNumber · PAN внутри текста", () => {
  it("PAN в середине строки маскируется", () => {
    const input = "Card: 4000 1234 5678 2487, expires 01/26";
    expect(maskCardNumber(input)).toBe("Card: **** **** **** 2487, expires 01/26");
  });

  it("несколько PAN в одной строке", () => {
    const input = "Card 4000 1234 5678 2487 to 5500 9988 7766 5544";
    expect(maskCardNumber(input)).toBe("Card **** **** **** 2487 to **** **** **** 5544");
  });
});

describe("scrubPaymentPayload · секретные ключи → REDACTED", () => {
  it("password / Signature / auth* / *_token / apiKey", () => {
    const input = {
      password: "secret123",
      Signature: "ABCDEF1234567890",
      auth_login: "admin",
      auth_password: "x",
      callback_token: "t",
      apiKey: "k",
      bearer_token: "b",
      OrderId: "BGX-20260427-0001",
    };
    const out = scrubPaymentPayload(input) as Record<string, string>;
    expect(out["password"]).toBe(REDACTED);
    expect(out["Signature"]).toBe(REDACTED);
    expect(out["auth_login"]).toBe(REDACTED);
    expect(out["auth_password"]).toBe(REDACTED);
    expect(out["callback_token"]).toBe(REDACTED);
    expect(out["apiKey"]).toBe(REDACTED);
    expect(out["bearer_token"]).toBe(REDACTED);
    expect(out["OrderId"]).toBe("BGX-20260427-0001");
  });

  it("регистр-нечувствителен (PASSWORD, SIGNATURE)", () => {
    const out = scrubPaymentPayload({ PASSWORD: "x", SIGNATURE: "y" }) as Record<string, string>;
    expect(out["PASSWORD"]).toBe(REDACTED);
    expect(out["SIGNATURE"]).toBe(REDACTED);
  });
});

describe("scrubPaymentPayload · PAN-маскирование значений", () => {
  it("CardNumber с PAN маскируется", () => {
    const out = scrubPaymentPayload({ CardNumber: "4000 1234 5678 2487" }) as Record<
      string,
      string
    >;
    expect(out["CardNumber"]).toBe("**** **** **** 2487");
  });

  it("уже маскированный CardNumber не трогается", () => {
    const out = scrubPaymentPayload({ CardNumber: "4000 **** **** 2487" }) as Record<
      string,
      string
    >;
    expect(out["CardNumber"]).toBe("4000 **** **** 2487");
  });
});

describe("scrubPaymentPayload · вложенные структуры", () => {
  it("nested object", () => {
    const input = {
      payment: {
        card: { number: "4000 1234 5678 2487" },
        password: "x",
      },
      meta: { orderId: "BGX-20260427-0001" },
    };
    const out = scrubPaymentPayload(input) as {
      payment: { card: { number: string }; password: string };
      meta: { orderId: string };
    };
    expect(out.payment.card.number).toBe("**** **** **** 2487");
    expect(out.payment.password).toBe(REDACTED);
    expect(out.meta.orderId).toBe("BGX-20260427-0001");
  });

  it("массив объектов", () => {
    const input = [{ card: "4000 1234 5678 2487" }, { card: "5500 9988 7766 5544" }];
    const out = scrubPaymentPayload(input) as Array<{ card: string }>;
    expect(out[0]!.card).toBe("**** **** **** 2487");
    expect(out[1]!.card).toBe("**** **** **** 5544");
  });

  it("null/undefined/numbers/booleans пропускаются как есть", () => {
    const input = { a: null, b: undefined, c: 42, d: true };
    expect(scrubPaymentPayload(input)).toEqual(input);
  });

  it("не мутирует исходный объект", () => {
    const input = { Signature: "secret", CardNumber: "4000 1234 5678 2487" };
    scrubPaymentPayload(input);
    expect(input.Signature).toBe("secret");
    expect(input.CardNumber).toBe("4000 1234 5678 2487");
  });
});

describe("scrubPaymentPayload · типичный Uniteller webhook payload", () => {
  it("полный webhook callback маскируется и сохраняет неsecret-поля", () => {
    const input = {
      Order_ID: "BGX-20260427-0042",
      Status: "Authorized",
      Signature: "DEADBEEF1234567890ABCDEF12345678",
      Billnumber: "RRN-987654321",
      Response_Code: "00",
      MeanType: "Card",
      CardNumber: "4000 1234 5678 2487",
    };
    const out = scrubPaymentPayload(input) as Record<string, string>;
    expect(out["Order_ID"]).toBe("BGX-20260427-0042");
    expect(out["Status"]).toBe("Authorized");
    expect(out["Signature"]).toBe(REDACTED);
    expect(out["Billnumber"]).toBe("RRN-987654321");
    expect(out["Response_Code"]).toBe("00");
    expect(out["CardNumber"]).toBe("**** **** **** 2487");
  });
});
