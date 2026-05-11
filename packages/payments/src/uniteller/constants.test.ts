import { describe, expect, it } from "vitest";

import { centsToUnitellerSubtotal, mapUnitellerStatus, UNITELLER } from "./constants";

describe("UNITELLER URLs", () => {
  it("покрывают все эндпоинты из §5.2 master-prompt", () => {
    expect(UNITELLER.payUrl).toBe("https://wpay.uniteller.ru/pay/");
    expect(UNITELLER.resultsUrl).toBe("https://wpay.uniteller.ru/results/");
    expect(UNITELLER.cancelUrl).toBe("https://wpay.uniteller.ru/cancel/");
    expect(UNITELLER.wsdlUrl).toBe("https://wpay.uniteller.ru/results/wsdl/");
    expect(UNITELLER.dashboardUrl).toBe("https://lk.uniteller.ru/");
  });

  it("все URL — HTTPS (§5.12 Security)", () => {
    for (const url of Object.values(UNITELLER)) {
      expect(url.startsWith("https://")).toBe(true);
    }
  });
});

describe("mapUnitellerStatus · §5.8 mapping", () => {
  it("Authorized/Paid → captured", () => {
    expect(mapUnitellerStatus("Authorized")).toBe("captured");
    expect(mapUnitellerStatus("Paid")).toBe("captured");
  });

  it("Canceled/NotAuthorized → failed", () => {
    expect(mapUnitellerStatus("Canceled")).toBe("failed");
    expect(mapUnitellerStatus("NotAuthorized")).toBe("failed");
  });

  it("Waiting → pending (остаётся в ожидании)", () => {
    expect(mapUnitellerStatus("Waiting")).toBe("pending");
  });
});

describe("centsToUnitellerSubtotal · §6.9 формат", () => {
  it("целые тысячи сумов", () => {
    expect(centsToUnitellerSubtotal(15_000 * 100)).toBe("15000.00");
    expect(centsToUnitellerSubtotal(1_500_000)).toBe("15000.00");
  });

  it("дробная часть выводится с ведущим нулём", () => {
    expect(centsToUnitellerSubtotal(150_001)).toBe("1500.01");
    expect(centsToUnitellerSubtotal(150_010)).toBe("1500.10");
    expect(centsToUnitellerSubtotal(100_000)).toBe("1000.00");
  });

  it("минимальные граничные случаи", () => {
    expect(centsToUnitellerSubtotal(0)).toBe("0.00");
    expect(centsToUnitellerSubtotal(1)).toBe("0.01");
    expect(centsToUnitellerSubtotal(99)).toBe("0.99");
    expect(centsToUnitellerSubtotal(100)).toBe("1.00");
  });

  it("большие суммы — до миллиардов тийинов", () => {
    expect(centsToUnitellerSubtotal(9_999_999_999)).toBe("99999999.99");
  });

  it("нецелый cents → TypeError", () => {
    expect(() => centsToUnitellerSubtotal(100.5)).toThrow(TypeError);
  });

  it("отрицательный cents → RangeError", () => {
    expect(() => centsToUnitellerSubtotal(-1)).toThrow(RangeError);
  });
});
