/**
 * P3-T1 unit-тесты: cart-store redux-логики + селекторов.
 *
 * Zustand-store — singleton; чистим через `_reset()` + `localStorage.clear()`
 * перед каждым тестом. Полифилл localStorage для node-env — в vitest.setup.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  CART_STORAGE_KEY,
  selectItemCount,
  selectLineSubtotalCents,
  selectSubtotalCents,
  selectTotalItems,
  useCart,
  type CartItemInput,
} from "./store";

function makeItem(partial: Partial<CartItemInput> = {}): CartItemInput {
  return {
    variantId: "v-1",
    productId: "p-1",
    productSlug: "pampers-premium-care-3",
    nameRu: "Pampers",
    nameUz: "Pampers",
    nameEn: "Pampers",
    brandName: "Pampers",
    imageUrl: null,
    color: null,
    size: "60 шт",
    priceCents: 18_500_000,
    oldPriceCents: null,
    ...partial,
  };
}

beforeEach(() => {
  localStorage.clear();
  useCart.getState()._reset();
});

describe("add", () => {
  it("добавляет новую позицию с qty=1 и addedAt", () => {
    useCart.getState().add(makeItem());
    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ variantId: "v-1", quantity: 1 });
    expect(items[0]?.addedAt).toBeTypeOf("number");
  });

  it("дубликаты по variantId мёрджит qty, не создаёт вторую строку", () => {
    useCart.getState().add(makeItem(), 2);
    useCart.getState().add(makeItem(), 3);
    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(5);
  });

  it("новые позиции кладутся в начало (recently added on top)", () => {
    useCart.getState().add(makeItem({ variantId: "v-1" }));
    useCart.getState().add(makeItem({ variantId: "v-2" }));
    const [first, second] = useCart.getState().items;
    expect(first?.variantId).toBe("v-2");
    expect(second?.variantId).toBe("v-1");
  });

  it("clamp qty ≤1 → 1, qty >99 → 99", () => {
    useCart.getState().add(makeItem(), 0);
    expect(useCart.getState().items[0]?.quantity).toBe(1);
    useCart.getState()._reset();
    useCart.getState().add(makeItem(), 10_000);
    expect(useCart.getState().items[0]?.quantity).toBe(99);
  });
});

describe("remove", () => {
  it("удаляет позицию по variantId", () => {
    useCart.getState().add(makeItem({ variantId: "v-1" }));
    useCart.getState().add(makeItem({ variantId: "v-2" }));
    useCart.getState().remove("v-1");
    expect(useCart.getState().items.map((i) => i.variantId)).toEqual(["v-2"]);
  });

  it("no-op для неизвестного variantId", () => {
    useCart.getState().add(makeItem());
    useCart.getState().remove("v-missing");
    expect(useCart.getState().items).toHaveLength(1);
  });
});

describe("setQuantity", () => {
  it("устанавливает конкретное qty", () => {
    useCart.getState().add(makeItem());
    useCart.getState().setQuantity("v-1", 7);
    expect(useCart.getState().items[0]?.quantity).toBe(7);
  });

  it("qty ≤ 0 → удаляет позицию (UX: очищенный input)", () => {
    useCart.getState().add(makeItem());
    useCart.getState().setQuantity("v-1", 0);
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("qty > 99 → clamp до 99", () => {
    useCart.getState().add(makeItem());
    useCart.getState().setQuantity("v-1", 500);
    expect(useCart.getState().items[0]?.quantity).toBe(99);
  });

  it("NaN → remove (безопасный fallback)", () => {
    useCart.getState().add(makeItem());
    useCart.getState().setQuantity("v-1", Number.NaN);
    expect(useCart.getState().items).toHaveLength(0);
  });
});

describe("inc / dec", () => {
  it("inc увеличивает на 1", () => {
    useCart.getState().add(makeItem());
    useCart.getState().inc("v-1");
    expect(useCart.getState().items[0]?.quantity).toBe(2);
  });

  it("dec при qty=1 удаляет позицию", () => {
    useCart.getState().add(makeItem());
    useCart.getState().dec("v-1");
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("dec при qty>1 уменьшает на 1", () => {
    useCart.getState().add(makeItem(), 3);
    useCart.getState().dec("v-1");
    expect(useCart.getState().items[0]?.quantity).toBe(2);
  });

  it("inc/dec no-op для неизвестного variantId", () => {
    useCart.getState().dec("v-missing");
    useCart.getState().inc("v-missing");
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("inc не превышает лимит 99", () => {
    useCart.getState().add(makeItem(), 99);
    useCart.getState().inc("v-1");
    expect(useCart.getState().items[0]?.quantity).toBe(99);
  });
});

describe("clear", () => {
  it("очищает все позиции", () => {
    useCart.getState().add(makeItem({ variantId: "v-1" }));
    useCart.getState().add(makeItem({ variantId: "v-2" }));
    useCart.getState().clear();
    expect(useCart.getState().items).toHaveLength(0);
  });
});

describe("селекторы", () => {
  it("selectTotalItems — сумма qty", () => {
    useCart.getState().add(makeItem({ variantId: "v-1" }), 2);
    useCart.getState().add(makeItem({ variantId: "v-2" }), 3);
    expect(selectTotalItems(useCart.getState())).toBe(5);
  });

  it("selectItemCount — уникальные line items", () => {
    useCart.getState().add(makeItem({ variantId: "v-1" }), 2);
    useCart.getState().add(makeItem({ variantId: "v-2" }), 5);
    expect(selectItemCount(useCart.getState())).toBe(2);
  });

  it("selectSubtotalCents — price × qty по всем строкам", () => {
    useCart.getState().add(makeItem({ variantId: "v-1", priceCents: 10_000 }), 2);
    useCart.getState().add(makeItem({ variantId: "v-2", priceCents: 15_000 }), 3);
    expect(selectSubtotalCents(useCart.getState())).toBe(10_000 * 2 + 15_000 * 3);
  });

  it("selectLineSubtotalCents — per-line", () => {
    const line = { ...makeItem({ priceCents: 18_500_000 }), quantity: 4, addedAt: 0 };
    expect(selectLineSubtotalCents(line)).toBe(18_500_000 * 4);
  });

  it("пустая корзина → 0", () => {
    expect(selectTotalItems(useCart.getState())).toBe(0);
    expect(selectItemCount(useCart.getState())).toBe(0);
    expect(selectSubtotalCents(useCart.getState())).toBe(0);
  });
});

describe("persist", () => {
  it("использует ключ bigmax:cart", () => {
    expect(CART_STORAGE_KEY).toBe("bigmax:cart");
  });

  it("сохраняет items в localStorage после add", () => {
    useCart.getState().add(makeItem());
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { items: unknown[] } };
    expect(parsed.state.items).toHaveLength(1);
  });

  it("partialize: персистит только items + appliedPromo", () => {
    useCart.getState().add(makeItem());
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(Object.keys(parsed.state).sort()).toEqual(["appliedPromo", "items"]);
    // isOpen / hydrated НЕ должны протекать в storage.
    expect(parsed.state).not.toHaveProperty("isOpen");
    expect(parsed.state).not.toHaveProperty("hydrated");
  });
});

describe("promo", () => {
  it("setPromo / clearPromo обновляют appliedPromo", () => {
    expect(useCart.getState().appliedPromo).toBeNull();
    useCart.getState().setPromo({
      code: "WELCOME10",
      type: "percent",
      value: 10,
      minOrderCents: 10_000_000,
    });
    expect(useCart.getState().appliedPromo?.code).toBe("WELCOME10");
    useCart.getState().clearPromo();
    expect(useCart.getState().appliedPromo).toBeNull();
  });

  it("appliedPromo персистится в localStorage", () => {
    useCart.getState().setPromo({
      code: "WELCOME10",
      type: "percent",
      value: 10,
      minOrderCents: 10_000_000,
    });
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { state: { appliedPromo: { code: string } | null } };
    expect(parsed.state.appliedPromo?.code).toBe("WELCOME10");
  });
});
