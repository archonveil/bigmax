import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it("empty input → empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("lowercase Latin", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("Latin diacritics стрипаются", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
    expect(slugify("naïve façade")).toBe("naive-facade");
    expect(slugify("Ñoño")).toBe("nono");
  });

  it("Russian Cyrillic → BGN-ish ASCII", () => {
    expect(slugify("Хлопок")).toBe("hlopok");
    expect(slugify("Пушистая шапка")).toBe("pushistaya-shapka");
    expect(slugify("Ёжик в тумане")).toBe("yozhik-v-tumane");
    expect(slugify("Объект")).toBe("obekt");
  });

  it("Uzbek Cyrillic supplementary letters", () => {
    expect(slugify("Тоғлар")).toBe("toglar");
    expect(slugify("Қалпоқ")).toBe("qalpoq");
    expect(slugify("Ўзбекистон")).toBe("ozbekiston");
    expect(slugify("Ҳаво")).toBe("havo");
  });

  it("Mixed Cyrillic + Latin + digits", () => {
    expect(slugify("Подгузники Pampers 3-5 кг")).toBe("podguzniki-pampers-3-5-kg");
  });

  it("Symbols → word equivalents", () => {
    expect(slugify("Tom & Jerry")).toBe("tom-and-jerry");
    expect(slugify("C++ programming")).toBe("c-plus-plus-programming");
    expect(slugify("50% скидка")).toBe("50-percent-skidka");
  });

  it("Collapses repeated separators + trims edges", () => {
    expect(slugify("---hello---world---")).toBe("hello-world");
    expect(slugify("  multiple   spaces  ")).toBe("multiple-spaces");
  });

  it("Cap по maxLength со стрипом висящего sep", () => {
    expect(slugify("the quick brown fox jumps over the lazy dog", { maxLength: 20 })).toBe(
      "the-quick-brown-fox",
    );
  });

  it("Snake separator option", () => {
    expect(slugify("Hello World", { separator: "_" })).toBe("hello_world");
    expect(slugify("Хлопковая майка", { separator: "_" })).toBe("hlopkovaya_mayka");
  });

  it("Discards punctuation and emoji", () => {
    expect(slugify("Hello, world! 🎉")).toBe("hello-world");
  });

  it("Чистый non-Latin/non-Cyrillic → пустая строка", () => {
    expect(slugify("中文")).toBe("");
    expect(slugify("🎉🎊")).toBe("");
  });

  it("Идемпотентность: slugify(slugify(x)) === slugify(x)", () => {
    const inputs = ["Hello World", "Хлопок", "Café Résumé", "Tom & Jerry"];
    for (const i of inputs) {
      const once = slugify(i);
      expect(slugify(once)).toBe(once);
    }
  });
});
