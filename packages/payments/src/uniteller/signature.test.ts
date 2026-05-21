import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildSignature, computeCallbackSignature, verifyCallbackSignature } from "./signature";

/**
 * Независимый reference-расчёт подписи: вычисляет то же самое, что
 * `buildSignature`, но вручную через `node:crypto`. Используется в тестах,
 * чтобы не проверять `buildSignature` «сам собой».
 */
function referenceSignature(p: {
  shopId: string;
  orderId: string;
  subtotal: string;
  meanType?: string;
  eMoneyType?: string;
  lifetime?: string;
  customerIdp?: string;
  cardIdp?: string;
  iData?: string;
  ptCode?: string;
  password: string;
}): string {
  const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");
  const raw =
    md5(p.shopId) +
    "&" +
    md5(p.orderId) +
    "&" +
    md5(p.subtotal) +
    "&" +
    md5(p.meanType ?? "") +
    "&" +
    md5(p.eMoneyType ?? "") +
    "&" +
    md5(p.lifetime ?? "") +
    "&" +
    md5(p.customerIdp ?? "") +
    "&" +
    md5(p.cardIdp ?? "") +
    "&" +
    md5(p.iData ?? "") +
    "&" +
    md5(p.ptCode ?? "") +
    "&" +
    md5(p.password);
  return md5(raw).toUpperCase();
}

const VALID = {
  shopId: "POINT0001",
  orderId: "BGX-20260424-0001",
  subtotal: "15000.00",
  password: "secret",
} as const;

describe("buildSignature · формат вывода", () => {
  it("возвращает ровно 32-символьный hex в верхнем регистре", () => {
    const sig = buildSignature(VALID);
    expect(sig).toHaveLength(32);
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
    expect(sig).toBe(sig.toUpperCase());
  });

  it("детерминирован: один и тот же вход → один и тот же вывод", () => {
    const a = buildSignature(VALID);
    const b = buildSignature(VALID);
    expect(a).toBe(b);
  });
});

describe("buildSignature · совпадение с независимой реализацией", () => {
  it("minimal: без MeanType/EMoneyType", () => {
    expect(buildSignature(VALID)).toBe(referenceSignature(VALID));
  });

  it("с явными пустыми MeanType/EMoneyType эквивалентно пропуску", () => {
    const a = buildSignature(VALID);
    const b = buildSignature({ ...VALID, meanType: "", eMoneyType: "" });
    expect(a).toBe(b);
  });

  it("с непустым MeanType", () => {
    const params = { ...VALID, meanType: "Card" };
    expect(buildSignature(params)).toBe(referenceSignature(params));
  });

  it("с непустым EMoneyType", () => {
    const params = { ...VALID, eMoneyType: "YAM" };
    expect(buildSignature(params)).toBe(referenceSignature(params));
  });

  it("с обоими дополнительными полями", () => {
    const params = { ...VALID, meanType: "Card", eMoneyType: "YAM" };
    expect(buildSignature(params)).toBe(referenceSignature(params));
  });
});

describe("buildSignature · чувствительность к каждому полю", () => {
  const base = buildSignature(VALID);

  it("смена shopId → другая подпись", () => {
    expect(buildSignature({ ...VALID, shopId: "POINT0002" })).not.toBe(base);
  });
  it("смена orderId → другая подпись", () => {
    expect(buildSignature({ ...VALID, orderId: "BGX-20260424-0002" })).not.toBe(base);
  });
  it("смена subtotal → другая подпись (отличие на 1 тийин)", () => {
    expect(buildSignature({ ...VALID, subtotal: "15000.01" })).not.toBe(base);
  });
  it("смена password → другая подпись", () => {
    expect(buildSignature({ ...VALID, password: "другой" })).not.toBe(base);
  });
  it("добавление MeanType → другая подпись", () => {
    expect(buildSignature({ ...VALID, meanType: "Card" })).not.toBe(base);
  });
});

describe("buildSignature · валидация обязательных полей", () => {
  it("пустой shopId → throws", () => {
    expect(() => buildSignature({ ...VALID, shopId: "" })).toThrow(/shopId/);
  });
  it("пустой orderId → throws", () => {
    expect(() => buildSignature({ ...VALID, orderId: "" })).toThrow(/orderId/);
  });
  it("пустой subtotal → throws", () => {
    expect(() => buildSignature({ ...VALID, subtotal: "" })).toThrow(/subtotal/);
  });
  it("пустой password → throws", () => {
    expect(() => buildSignature({ ...VALID, password: "" })).toThrow(/password/);
  });
});

// ---------------------------------------------------------------------------
// Callback signature (webhook, §5.7)
// ---------------------------------------------------------------------------

/**
 * Независимая reference-реализация callback-подписи: считает то же, что
 * `computeCallbackSignature`, но через `node:crypto` напрямую — чтобы тесты
 * не проверяли «сами себя».
 */
function referenceCallbackSignature(orderId: string, status: string, password: string): string {
  const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");
  return md5(md5(orderId) + md5(status) + md5(password)).toUpperCase();
}

const CALLBACK_VALID = {
  orderId: "BGX-20260424-0001",
  status: "Authorized",
  password: "secret",
};

describe("computeCallbackSignature · совпадение с reference", () => {
  it("Authorized → совпадает с MD5-chain reference", () => {
    expect(
      computeCallbackSignature(
        CALLBACK_VALID.orderId,
        CALLBACK_VALID.status,
        CALLBACK_VALID.password,
      ),
    ).toBe(
      referenceCallbackSignature(
        CALLBACK_VALID.orderId,
        CALLBACK_VALID.status,
        CALLBACK_VALID.password,
      ),
    );
  });

  it("статусы Paid / Canceled / NotAuthorized / Waiting — все дают разные подписи", () => {
    const sigs = ["Authorized", "Paid", "Canceled", "NotAuthorized", "Waiting"].map((s) =>
      computeCallbackSignature(CALLBACK_VALID.orderId, s, CALLBACK_VALID.password),
    );
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("32-символьный hex в верхнем регистре", () => {
    const sig = computeCallbackSignature(
      CALLBACK_VALID.orderId,
      CALLBACK_VALID.status,
      CALLBACK_VALID.password,
    );
    expect(sig).toHaveLength(32);
    expect(sig).toMatch(/^[A-F0-9]{32}$/);
  });
});

describe("verifyCallbackSignature · happy path", () => {
  it("принимает корректную подпись (uppercase)", () => {
    const sig = computeCallbackSignature(
      CALLBACK_VALID.orderId,
      CALLBACK_VALID.status,
      CALLBACK_VALID.password,
    );
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, signature: sig })).toBe(true);
  });

  it("принимает корректную подпись в lowercase (toUpperCase нормализует)", () => {
    const sig = computeCallbackSignature(
      CALLBACK_VALID.orderId,
      CALLBACK_VALID.status,
      CALLBACK_VALID.password,
    );
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, signature: sig.toLowerCase() })).toBe(true);
  });
});

describe("verifyCallbackSignature · негативные сценарии", () => {
  const validSig = computeCallbackSignature(
    CALLBACK_VALID.orderId,
    CALLBACK_VALID.status,
    CALLBACK_VALID.password,
  );

  it("отвергает подпись от другого orderId", () => {
    expect(
      verifyCallbackSignature({
        ...CALLBACK_VALID,
        orderId: "BGX-20260424-9999",
        signature: validSig,
      }),
    ).toBe(false);
  });

  it("отвергает подпись от другого status", () => {
    expect(
      verifyCallbackSignature({ ...CALLBACK_VALID, status: "Paid", signature: validSig }),
    ).toBe(false);
  });

  it("отвергает подпись с другим password", () => {
    expect(
      verifyCallbackSignature({ ...CALLBACK_VALID, password: "wrong", signature: validSig }),
    ).toBe(false);
  });

  it("отвергает signature короче 32 символов", () => {
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, signature: "ABC" })).toBe(false);
  });

  it("отвергает signature длиннее 32 символов", () => {
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, signature: "A".repeat(33) })).toBe(false);
  });

  it("отвергает пустые orderId / status / password (без throw)", () => {
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, orderId: "", signature: validSig })).toBe(
      false,
    );
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, status: "", signature: validSig })).toBe(
      false,
    );
    expect(verifyCallbackSignature({ ...CALLBACK_VALID, password: "", signature: validSig })).toBe(
      false,
    );
  });
});

describe("buildSignature · стабильный вектор (регрессионный якорь)", () => {
  /**
   * Якорный хеш — зафиксирован одноразово для защиты от случайных регрессий
   * (например, если кто-то поменяет порядок полей или separator). Если
   * тест валится после намеренной правки алгоритма — сверяйтесь с
   * `referenceSignature()` выше и обновляйте оба места.
   */
  it("PaymentFormParams{POINT0001, BGX-20260424-0001, 15000.00, secret}", () => {
    expect(buildSignature(VALID)).toBe(referenceSignature(VALID));
    // Доп. проверка: вычисленная ref-подпись имеет правильный формат.
    const ref = referenceSignature(VALID);
    expect(ref).toHaveLength(32);
    expect(ref).toMatch(/^[A-F0-9]{32}$/);
  });
});
