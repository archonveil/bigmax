/**
 * P6-T7: Pure-helpers для admin-stock — querystring sanitize, applyAdjust,
 * Zod-схемы, parseStockCsv.
 */

import { describe, expect, it } from "vitest";

import {
  StockAdjustSchema,
  StockBulkAdjustSchema,
  StockImportRowSchema,
  StockUpsertSchema,
  applyAdjust,
  parseAdminStockListQuery,
  parseStockCsv,
  skuPatternToLike,
} from "./admin-stock";

describe("parseAdminStockListQuery", () => {
  const defaults = {
    branchId: null,
    q: null,
    statuses: [] as ("ok" | "low" | "out")[],
    availableMin: null,
    availableMax: null,
    sort: "available_asc",
    page: 1,
  };

  it("пустые → defaults", () => {
    expect(parseAdminStockListQuery({})).toEqual(defaults);
  });

  it("undefined → defaults", () => {
    expect(parseAdminStockListQuery(undefined)).toEqual(defaults);
  });

  it("happy: branchId + q + statuses + sort + page", () => {
    expect(
      parseAdminStockListQuery({
        branchId: "br-1",
        q: "NB-",
        status: ["low", "out"],
        sort: "updated_desc",
        page: "2",
      }),
    ).toEqual({
      ...defaults,
      branchId: "br-1",
      q: "NB-",
      statuses: ["low", "out"],
      sort: "updated_desc",
      page: 2,
    });
  });

  it("legacy lowStock=true → projects to statuses [low, out]", () => {
    expect(parseAdminStockListQuery({ lowStock: "true" }).statuses).toEqual(["low", "out"]);
  });

  it("invalid status values отбрасываются", () => {
    expect(parseAdminStockListQuery({ status: ["bogus", "low"] }).statuses).toEqual(["low"]);
  });

  it("availableMin / availableMax парсятся", () => {
    const q = parseAdminStockListQuery({ minAvailable: "5", maxAvailable: "20" });
    expect(q.availableMin).toBe(5);
    expect(q.availableMax).toBe(20);
  });

  it("page нечисло → 1", () => {
    expect(parseAdminStockListQuery({ page: "abc" }).page).toBe(1);
    expect(parseAdminStockListQuery({ page: "-3" }).page).toBe(1);
    expect(parseAdminStockListQuery({ page: "0" }).page).toBe(1);
  });

  it("q обрезается до 100", () => {
    const long = "x".repeat(200);
    expect(parseAdminStockListQuery({ q: long }).q?.length).toBe(100);
  });

  it("array values → берём первый", () => {
    expect(parseAdminStockListQuery({ branchId: ["a", "b"] }).branchId).toBe("a");
  });
});

describe("applyAdjust", () => {
  it("set: возвращает value", () => {
    expect(applyAdjust(10, "set", 25)).toBe(25);
  });

  it("set: 0 → 0", () => {
    expect(applyAdjust(10, "set", 0)).toBe(0);
  });

  it("inc: oldQty + value", () => {
    expect(applyAdjust(10, "inc", 5)).toBe(15);
  });

  it("dec: oldQty - value", () => {
    expect(applyAdjust(10, "dec", 3)).toBe(7);
  });

  it("dec: clamp на 0 (не уходим в минус)", () => {
    expect(applyAdjust(3, "dec", 10)).toBe(0);
  });

  it("set с отрицательным невозможен на schema-уровне, но runtime-clamp работает", () => {
    expect(applyAdjust(10, "set", -5)).toBe(0);
  });
});

describe("StockAdjustSchema", () => {
  it("happy: set 100 + reason", () => {
    expect(
      StockAdjustSchema.safeParse({
        mode: "set",
        value: 100,
        reason: "Inventory recount",
      }).success,
    ).toBe(true);
  });

  it("inc + dec тоже валидны", () => {
    expect(
      StockAdjustSchema.safeParse({ mode: "inc", value: 5, reason: "Поступление" }).success,
    ).toBe(true);
    expect(StockAdjustSchema.safeParse({ mode: "dec", value: 2, reason: "Брак" }).success).toBe(
      true,
    );
  });

  it("неизвестный mode → fail", () => {
    expect(StockAdjustSchema.safeParse({ mode: "bogus", value: 1, reason: "ok" }).success).toBe(
      false,
    );
  });

  it("value отрицательный → fail", () => {
    expect(StockAdjustSchema.safeParse({ mode: "set", value: -5, reason: "ok ok" }).success).toBe(
      false,
    );
  });

  it("value > 1M → fail", () => {
    expect(
      StockAdjustSchema.safeParse({
        mode: "set",
        value: 1_000_001,
        reason: "ok ok",
      }).success,
    ).toBe(false);
  });

  it("reason < 3 → reason_too_short", () => {
    const r = StockAdjustSchema.safeParse({ mode: "set", value: 10, reason: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_short");
  });

  it("reason > 500 → reason_too_long", () => {
    const r = StockAdjustSchema.safeParse({
      mode: "set",
      value: 10,
      reason: "x".repeat(501),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("reason_too_long");
  });

  it("strict: лишние поля → fail", () => {
    expect(
      StockAdjustSchema.safeParse({
        mode: "set",
        value: 10,
        reason: "ok ok",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe("StockUpsertSchema", () => {
  it("happy", () => {
    expect(
      StockUpsertSchema.safeParse({
        variantId: "v1",
        branchId: "b1",
        quantity: 50,
        reason: "Initial setup",
      }).success,
    ).toBe(true);
  });

  it("quantity = 0 → ok (явное обнуление)", () => {
    expect(
      StockUpsertSchema.safeParse({
        variantId: "v1",
        branchId: "b1",
        quantity: 0,
        reason: "Списано",
      }).success,
    ).toBe(true);
  });

  it("quantity < 0 → fail", () => {
    expect(
      StockUpsertSchema.safeParse({
        variantId: "v1",
        branchId: "b1",
        quantity: -1,
        reason: "ok ok",
      }).success,
    ).toBe(false);
  });
});

describe("StockImportRowSchema", () => {
  it("happy с branch_slug", () => {
    expect(
      StockImportRowSchema.safeParse({
        sku: "NB-1",
        branch_slug: "tashkent",
        quantity: 10,
      }).success,
    ).toBe(true);
  });

  it("happy с branch_id", () => {
    expect(
      StockImportRowSchema.safeParse({
        sku: "NB-1",
        branch_id: "br-cuid",
        quantity: 10,
      }).success,
    ).toBe(true);
  });

  it("без branch_slug и branch_id → fail (branch_required)", () => {
    expect(StockImportRowSchema.safeParse({ sku: "NB-1", quantity: 10 }).success).toBe(false);
  });

  it("quantity coerce из строки", () => {
    const r = StockImportRowSchema.safeParse({
      sku: "NB-1",
      branch_slug: "x",
      quantity: "25",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity).toBe(25);
  });

  it("quantity невалидная строка → fail", () => {
    expect(
      StockImportRowSchema.safeParse({
        sku: "NB-1",
        branch_slug: "x",
        quantity: "abc",
      }).success,
    ).toBe(false);
  });
});

describe("skuPatternToLike", () => {
  it("`*` → `%`", () => {
    expect(skuPatternToLike("NB-*")).toBe("NB-%");
    expect(skuPatternToLike("*-PK")).toBe("%-PK");
    expect(skuPatternToLike("CH-*-WH")).toBe("CH-%-WH");
  });

  it("`%` экранируется (защита от LIKE-injection)", () => {
    expect(skuPatternToLike("NB-100%")).toBe("NB-100\\%");
  });

  it("`_` экранируется", () => {
    expect(skuPatternToLike("NB_PK")).toBe("NB\\_PK");
  });

  it("без wildcard → без изменений", () => {
    expect(skuPatternToLike("NB-PAC-PK")).toBe("NB-PAC-PK");
  });
});

describe("StockBulkAdjustSchema", () => {
  it("happy", () => {
    expect(
      StockBulkAdjustSchema.safeParse({
        branchId: "br-1",
        skuPattern: "NB-*",
        mode: "set",
        value: 50,
        reason: "Inventory recount",
      }).success,
    ).toBe(true);
  });

  it("дефолт limit = 200", () => {
    const r = StockBulkAdjustSchema.safeParse({
      branchId: "br-1",
      skuPattern: "NB-*",
      mode: "inc",
      value: 5,
      reason: "Поступление",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(200);
  });

  it("limit > 200 → fail", () => {
    expect(
      StockBulkAdjustSchema.safeParse({
        branchId: "br-1",
        skuPattern: "*",
        mode: "set",
        value: 0,
        reason: "Reset all",
        limit: 500,
      }).success,
    ).toBe(false);
  });

  it("skuPattern пустой → fail", () => {
    expect(
      StockBulkAdjustSchema.safeParse({
        branchId: "br-1",
        skuPattern: "",
        mode: "set",
        value: 5,
        reason: "ok ok",
      }).success,
    ).toBe(false);
  });
});

describe("parseStockCsv", () => {
  it("empty → empty reason", () => {
    expect(parseStockCsv("").ok).toBe(false);
    expect(parseStockCsv("   \n   ").ok).toBe(false);
  });

  it("missing columns → missing_columns", () => {
    const r = parseStockCsv("sku,quantity\nNB-1,10");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_columns");
  });

  it("happy с branch_slug", () => {
    const csv = "sku,branch_slug,quantity\nNB-1,tashkent,25\nNB-2,samarkand,10";
    const r = parseStockCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]).toEqual({ sku: "NB-1", branch_slug: "tashkent", quantity: "25" });
    }
  });

  it("CRLF norm + trimming пустых строк", () => {
    const csv = "sku,branch_slug,quantity\r\nNB-1,t,10\r\n\r\nNB-2,s,20\r\n";
    const r = parseStockCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it("> 1000 строк → too_many_rows", () => {
    const lines = ["sku,branch_slug,quantity"];
    for (let i = 0; i < 1001; i += 1) lines.push(`NB-${i},t,10`);
    const r = parseStockCsv(lines.join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_many_rows");
  });

  it("пустые ячейки игнорируются", () => {
    const csv = "sku,branch_slug,branch_id,quantity\nNB-1,tashkent,,10";
    const r = parseStockCsv(csv);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0]).toEqual({ sku: "NB-1", branch_slug: "tashkent", quantity: "10" });
      expect("branch_id" in r.rows[0]!).toBe(false);
    }
  });
});
