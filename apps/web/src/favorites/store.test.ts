import { beforeEach, describe, expect, it } from "vitest";

import {
  FAVORITES_STORAGE_KEY,
  selectFavoritesCount,
  useFavorites,
  type FavoriteItemInput,
} from "./store";

function makeItem(partial: Partial<FavoriteItemInput> = {}): FavoriteItemInput {
  return {
    productId: "p-1",
    slug: "pampers-premium-care-3",
    nameRu: "Pampers",
    nameUz: "Pampers",
    nameEn: "Pampers",
    brandName: "Pampers",
    imageUrl: null,
    minPriceCents: 18_500_000,
    ...partial,
  };
}

beforeEach(() => {
  localStorage.clear();
  useFavorites.getState()._reset();
});

describe("add / remove / has", () => {
  it("add создаёт позицию с addedAt", () => {
    useFavorites.getState().add(makeItem());
    const items = useFavorites.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.productId).toBe("p-1");
    expect(items[0]?.addedAt).toBeTypeOf("number");
  });

  it("add дубликата — no-op (уникальность по productId)", () => {
    useFavorites.getState().add(makeItem());
    useFavorites.getState().add(makeItem());
    expect(useFavorites.getState().items).toHaveLength(1);
  });

  it("новые позиции идут в начало", () => {
    useFavorites.getState().add(makeItem({ productId: "p-1" }));
    useFavorites.getState().add(makeItem({ productId: "p-2" }));
    expect(useFavorites.getState().items.map((i) => i.productId)).toEqual(["p-2", "p-1"]);
  });

  it("remove удаляет по productId", () => {
    useFavorites.getState().add(makeItem({ productId: "p-1" }));
    useFavorites.getState().add(makeItem({ productId: "p-2" }));
    useFavorites.getState().remove("p-1");
    expect(useFavorites.getState().items.map((i) => i.productId)).toEqual(["p-2"]);
  });

  it("has — true/false", () => {
    useFavorites.getState().add(makeItem());
    expect(useFavorites.getState().has("p-1")).toBe(true);
    expect(useFavorites.getState().has("missing")).toBe(false);
  });
});

describe("toggle", () => {
  it("добавляет при отсутствии → 'added'", () => {
    const r = useFavorites.getState().toggle(makeItem());
    expect(r).toBe("added");
    expect(useFavorites.getState().items).toHaveLength(1);
  });

  it("удаляет при наличии → 'removed'", () => {
    useFavorites.getState().add(makeItem());
    const r = useFavorites.getState().toggle(makeItem());
    expect(r).toBe("removed");
    expect(useFavorites.getState().items).toHaveLength(0);
  });
});

describe("clear / setItems", () => {
  it("clear очищает всё", () => {
    useFavorites.getState().add(makeItem({ productId: "p-1" }));
    useFavorites.getState().add(makeItem({ productId: "p-2" }));
    useFavorites.getState().clear();
    expect(useFavorites.getState().items).toHaveLength(0);
  });

  it("setItems полностью заменяет список (для server-sync)", () => {
    useFavorites.getState().add(makeItem({ productId: "p-local" }));
    useFavorites.getState().setItems([
      { ...makeItem({ productId: "p-server-1" }), addedAt: 1000 },
      { ...makeItem({ productId: "p-server-2" }), addedAt: 2000 },
    ]);
    expect(useFavorites.getState().items.map((i) => i.productId)).toEqual([
      "p-server-1",
      "p-server-2",
    ]);
  });
});

describe("селекторы", () => {
  it("selectFavoritesCount", () => {
    useFavorites.getState().add(makeItem({ productId: "p-1" }));
    useFavorites.getState().add(makeItem({ productId: "p-2" }));
    expect(selectFavoritesCount(useFavorites.getState())).toBe(2);
  });
});

describe("persist", () => {
  it("ключ bigmax:favorites", () => {
    expect(FAVORITES_STORAGE_KEY).toBe("bigmax:favorites");
  });

  it("items персистятся, hydrated — нет", () => {
    useFavorites.getState().add(makeItem());
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(Object.keys(parsed.state).sort()).toEqual(["items"]);
    expect((parsed.state as { items: unknown[] }).items).toHaveLength(1);
  });
});
