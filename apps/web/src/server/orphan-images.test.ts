import { describe, expect, it } from "vitest";

import { collectReferencedHashes, extractHashFromUrl } from "./orphan-images";

describe("orphan-images / extractHashFromUrl", () => {
  it("extracts shard+hash from canonical /uploads/products/.../ URL", () => {
    expect(extractHashFromUrl("/uploads/products/ab/abcdef0123456789/original.jpg")).toEqual({
      shard: "ab",
      hash: "abcdef0123456789",
    });
  });

  it("extracts from sub-size URL (w400.webp)", () => {
    expect(extractHashFromUrl("/uploads/products/ab/abcdef0123456789/w400.webp")).toEqual({
      shard: "ab",
      hash: "abcdef0123456789",
    });
  });

  it("returns null for external CDN URL", () => {
    expect(extractHashFromUrl("https://img.freepik.com/foo.jpg")).toBeNull();
    expect(extractHashFromUrl("https://placehold.co/600x400.png")).toBeNull();
  });

  it("returns null for relative public asset (не /uploads/products/)", () => {
    expect(extractHashFromUrl("/product-placeholder.svg")).toBeNull();
    expect(extractHashFromUrl("/uploads/other/foo.jpg")).toBeNull();
  });

  it("returns null for malformed URL (no hash segment)", () => {
    expect(extractHashFromUrl("/uploads/products/")).toBeNull();
    expect(extractHashFromUrl("/uploads/products/ab")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractHashFromUrl("")).toBeNull();
  });
});

describe("orphan-images / collectReferencedHashes", () => {
  it("collects hash from `url` field", () => {
    const set = collectReferencedHashes([
      { url: "/uploads/products/ab/aaa111/original.jpg", sizes: null, avifSizes: null },
    ]);
    expect(set.has("aaa111")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("collects hashes from sizes JSON (Phase 5)", () => {
    const set = collectReferencedHashes([
      {
        url: "/uploads/products/ab/aaa111/original.jpg",
        sizes: {
          w400: "/uploads/products/ab/aaa111/w400.webp",
          w800: "/uploads/products/cd/bbb222/w800.webp",
        },
        avifSizes: null,
      },
    ]);
    // sizes указывает на 2 hash'а — оба должны попасть. (Реалистично один
    // url+sizes относится к одной картинке, но логика тяжелее проверяется
    // на смешанных данных.)
    expect(set.has("aaa111")).toBe(true);
    expect(set.has("bbb222")).toBe(true);
  });

  it("collects hashes from avifSizes JSON (Phase 5b)", () => {
    const set = collectReferencedHashes([
      {
        url: "/uploads/products/ab/aaa111/original.jpg",
        sizes: null,
        avifSizes: { w400: "/uploads/products/ab/aaa111/w400.avif" },
      },
    ]);
    expect(set.has("aaa111")).toBe(true);
  });

  it("ignores external CDN urls", () => {
    const set = collectReferencedHashes([
      { url: "https://img.freepik.com/foo.jpg", sizes: null, avifSizes: null },
    ]);
    expect(set.size).toBe(0);
  });

  it("ignores malformed sizes JSON (not an object / array / non-string values)", () => {
    const set = collectReferencedHashes([
      {
        url: "/uploads/products/ab/aaa111/original.jpg",
        sizes: "not an object",
        avifSizes: [1, 2, 3],
      },
    ]);
    // url по-прежнему даёт aaa111.
    expect(set.size).toBe(1);
    expect(set.has("aaa111")).toBe(true);
  });

  it("dedupes across multiple rows referencing same hash", () => {
    const set = collectReferencedHashes([
      { url: "/uploads/products/ab/aaa111/original.jpg", sizes: null, avifSizes: null },
      { url: "/uploads/products/ab/aaa111/original.jpg", sizes: null, avifSizes: null },
      {
        url: "/uploads/products/ab/aaa111/w800.webp",
        sizes: null,
        avifSizes: null,
      },
    ]);
    expect(set.size).toBe(1);
    expect(set.has("aaa111")).toBe(true);
  });

  it("returns empty set for empty input", () => {
    expect(collectReferencedHashes([]).size).toBe(0);
  });
});
