import { describe, expect, it } from "vitest";

import { buildSku } from "./variants-manager";

describe("buildSku", () => {
  it("base — slug + color + size → uppercase joined with dashes", () => {
    expect(buildSku("pampers-care", "white", "m")).toBe("PAMPERS-CARE-WHITE-M");
  });

  it("missing color and size — only slug-based prefix", () => {
    expect(buildSku("nuby-bottle", "", "")).toBe("NUBY-BOTTLE");
  });

  it("missing color but size present", () => {
    expect(buildSku("baby-shoes", "", "32")).toBe("BABY-SHOES-32");
  });

  it("missing slug returns empty (placeholder fallback)", () => {
    expect(buildSku("", "", "")).toBe("");
  });

  it("strips disallowed characters and collapses dashes", () => {
    expect(buildSku("pamp&rs care", "Light Blue", "M/L")).toBe("PAMP-RS-CARE-LIGHT-BLUE-M-L");
  });

  it("trims trailing dashes after slice", () => {
    const slug = "a".repeat(60);
    const result = buildSku(slug, "white", "m");
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith("-")).toBe(false);
  });

  it("uppercases mixed-case input", () => {
    expect(buildSku("Slug", "Blue", "Sm")).toBe("SLUG-BLUE-SM");
  });

  it("ignores leading/trailing whitespace", () => {
    expect(buildSku("  slug ", " white ", " m ")).toBe("SLUG-WHITE-M");
  });
});
