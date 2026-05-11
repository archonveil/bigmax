/**
 * P7-T1: pure-helpers + Zod-схемы admin-promo + `incrementPromoUsage`.
 *
 * `incrementPromoUsage` тестируется с fake-`tx`-объектом: проверяем что
 * (а) при `null`/пустой строке не делаем DB-вызов, (б) код нормализуется
 * в UPPER, (в) `updateMany` вызывается с `{ increment: 1 }`.
 */

import { describe, expect, it, vi } from "vitest";

import {
  PromoCreateSchema,
  PromoUpdateSchema,
  incrementPromoUsage,
  parseAdminPromoListQuery,
} from "./admin-promo";

describe("parseAdminPromoListQuery", () => {
  it("пустые → defaults", () => {
    expect(parseAdminPromoListQuery({})).toEqual({
      q: null,
      activeOnly: null,
      sort: "createdAt_desc",
      page: 1,
    });
  });

  it("undefined → defaults", () => {
    expect(parseAdminPromoListQuery(undefined)).toEqual({
      q: null,
      activeOnly: null,
      sort: "createdAt_desc",
      page: 1,
    });
  });

  it("happy: q + active + sort + page", () => {
    expect(
      parseAdminPromoListQuery({
        q: "summer",
        active: "true",
        sort: "code_asc",
        page: "3",
      }),
    ).toEqual({ q: "summer", activeOnly: true, sort: "code_asc", page: 3 });
  });

  it("active=false → filter only disabled", () => {
    expect(parseAdminPromoListQuery({ active: "false" }).activeOnly).toBe(false);
  });

  it("неизвестный sort → createdAt_desc", () => {
    expect(parseAdminPromoListQuery({ sort: "bogus" }).sort).toBe("createdAt_desc");
  });

  it("page нечисло / отрицательное → 1", () => {
    expect(parseAdminPromoListQuery({ page: "abc" }).page).toBe(1);
    expect(parseAdminPromoListQuery({ page: "-5" }).page).toBe(1);
    expect(parseAdminPromoListQuery({ page: "0" }).page).toBe(1);
  });

  it("array params → берём первый", () => {
    expect(parseAdminPromoListQuery({ q: ["aaa", "bbb"] }).q).toBe("aaa");
  });
});

describe("PromoCreateSchema", () => {
  const base = { type: "percent" as const, value: 10 };

  it("happy: код, тип, значение — UPPER нормализация", () => {
    const r = PromoCreateSchema.safeParse({ ...base, code: "summer10" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("SUMMER10");
      expect(r.data.minOrderCents).toBe(0);
      expect(r.data.isActive).toBe(true);
      expect(r.data.startsAt).toBeNull();
      expect(r.data.endsAt).toBeNull();
    }
  });

  it("слишком короткий код → code_too_short", () => {
    const r = PromoCreateSchema.safeParse({ ...base, code: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("code_too_short");
    }
  });

  it("кириллица в коде → code_invalid", () => {
    const r = PromoCreateSchema.safeParse({ ...base, code: "ЛЕТО10" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("code_invalid");
    }
  });

  it("percent > 100 → percent_out_of_range", () => {
    const r = PromoCreateSchema.safeParse({ code: "ABCD", type: "percent", value: 150 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("percent_out_of_range");
    }
  });

  it("fixed: value в тийнах — допустим > 100", () => {
    const r = PromoCreateSchema.safeParse({ code: "FIX100K", type: "fixed", value: 10_000_000 });
    expect(r.success).toBe(true);
  });

  it("ends < starts → ends_before_starts", () => {
    const r = PromoCreateSchema.safeParse({
      code: "WIN",
      type: "percent",
      value: 5,
      startsAt: "2026-06-01T00:00:00Z",
      endsAt: "2026-05-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("ends_before_starts");
    }
  });

  it("free_delivery: value=0 ok", () => {
    const r = PromoCreateSchema.safeParse({ code: "FREESHIP", type: "free_delivery", value: 0 });
    expect(r.success).toBe(true);
  });

  it("usageLimit: 0 — invalid (Zod .min(1))", () => {
    const r = PromoCreateSchema.safeParse({ ...base, code: "ABCD", usageLimit: 0 });
    expect(r.success).toBe(false);
  });

  it("strict: лишние поля → fail", () => {
    const r = PromoCreateSchema.safeParse({ ...base, code: "ABCD", _evil: true });
    expect(r.success).toBe(false);
  });
});

describe("PromoUpdateSchema", () => {
  it("все поля optional — пустой patch допустим", () => {
    const r = PromoUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("смена type без value → value_required_when_type_changes", () => {
    const r = PromoUpdateSchema.safeParse({ type: "fixed" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("value_required_when_type_changes");
    }
  });

  it("смена type с валидным value → ок", () => {
    const r = PromoUpdateSchema.safeParse({ type: "fixed", value: 5000 });
    expect(r.success).toBe(true);
  });

  it("смена type на percent с value > 100 → percent_out_of_range", () => {
    const r = PromoUpdateSchema.safeParse({ type: "percent", value: 150 });
    expect(r.success).toBe(false);
    if (!r.success) {
      // value_required_when_type_changes refine идёт первым, поэтому второй
      // refine percent_out_of_range срабатывает только когда value передан.
      expect(r.error.issues[0]?.message).toBe("percent_out_of_range");
    }
  });

  it("UPPER нормализация при смене кода", () => {
    const r = PromoUpdateSchema.safeParse({ code: "newcode" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.code).toBe("NEWCODE");
  });
});

describe("incrementPromoUsage", () => {
  function makeFakeTx(): {
    promo: { updateMany: ReturnType<typeof vi.fn> };
  } {
    return { promo: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  }

  it("null → no-op", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx с одним методом — достаточно для теста.
    await incrementPromoUsage(tx, null);
    expect(tx.promo.updateMany).not.toHaveBeenCalled();
  });

  it("undefined → no-op", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx с одним методом — достаточно для теста.
    await incrementPromoUsage(tx, undefined);
    expect(tx.promo.updateMany).not.toHaveBeenCalled();
  });

  it("пустая строка → no-op", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx с одним методом — достаточно для теста.
    await incrementPromoUsage(tx, "   ");
    expect(tx.promo.updateMany).not.toHaveBeenCalled();
  });

  it("trim + UPPER + increment 1", async () => {
    const tx = makeFakeTx();
    // @ts-expect-error fake-tx с одним методом — достаточно для теста.
    await incrementPromoUsage(tx, "  summer10  ");
    expect(tx.promo.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.promo.updateMany).toHaveBeenCalledWith({
      where: { code: "SUMMER10" },
      data: { usedCount: { increment: 1 } },
    });
  });
});
