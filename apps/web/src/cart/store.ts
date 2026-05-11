/**
 * Zustand cart-store (F6). Persist в `localStorage` под ключом `bigmax:cart`.
 *
 * Решения:
 *   - В корзине храним snapshot товара (имя × 3 локали, бренд, фото, цена,
 *     цвет/размер) — Sheet и `/cart` рендерятся без похода в Prisma. При
 *     чекауте (P4) цены/остатки будут ре-валидированы с сервера.
 *   - `items: CartItem[]` (не Record) — упорядоченность важна для UI
 *     «recently added on top»; лукап по `variantId` O(n), корзина
 *     типично < 20 позиций.
 *   - Флаг `hydrated` нужен клиентским компонентам, чтобы не рендерить
 *     счётчики до rehydrate (иначе SSR=0 → client=N → гидрейшен-варнинг).
 *   - Селекторы — чистые функции поверх state; используются `useCart(selector)`.
 *
 * Публичное API — только то, что нужно UI; прямой set/clear state'а снаружи
 * не ожидаем (shallow-persist поверх `partialize` → items).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AppliedPromo } from "./promo";

export const CART_STORAGE_KEY = "bigmax:cart";
export const CART_VERSION = 1;

export interface CartItem {
  /** Unique key в корзине — строго по варианту. */
  variantId: string;
  productId: string;
  productSlug: string;
  /** Snapshot имён — чтобы рендерить на текущей локали пользователя. */
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  /** Цена варианта в тийнах на момент добавления. */
  priceCents: number;
  oldPriceCents: number | null;
  quantity: number;
  /** ms epoch — «recently added on top». */
  addedAt: number;
}

/** Поля, которые каллер задаёт при `add()`. Остальное (qty/addedAt) — на стороне store. */
export type CartItemInput = Omit<CartItem, "quantity" | "addedAt">;

interface CartState {
  items: CartItem[];
  hydrated: boolean;
  /** Открыт ли Cart Sheet. НЕ персистится — UI-only. */
  isOpen: boolean;
  /** Применённый промокод (валидирован сервером). Персистится. */
  appliedPromo: AppliedPromo | null;
}

interface CartActions {
  add(item: CartItemInput, quantity?: number): void;
  remove(variantId: string): void;
  setQuantity(variantId: string, quantity: number): void;
  inc(variantId: string): void;
  dec(variantId: string): void;
  clear(): void;
  openSheet(): void;
  closeSheet(): void;
  setSheetOpen(open: boolean): void;
  setPromo(promo: AppliedPromo): void;
  clearPromo(): void;
  /** Тестовый helper — сбрасывает state без вызова localStorage.clear(). */
  _reset(): void;
}

export type CartStore = CartState & CartActions;

const MAX_LINE_QTY = 99;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_LINE_QTY) return MAX_LINE_QTY;
  return floored;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,
      isOpen: false,
      appliedPromo: null,

      add(input, quantity = 1) {
        const addQty = clampQty(quantity);
        const existing = get().items.find((it) => it.variantId === input.variantId);
        if (existing) {
          set({
            items: get().items.map((it) =>
              it.variantId === input.variantId
                ? { ...it, quantity: clampQty(it.quantity + addQty) }
                : it,
            ),
          });
          return;
        }
        // Новые позиции — в начало (recently added on top).
        const next: CartItem = { ...input, quantity: addQty, addedAt: Date.now() };
        set({ items: [next, ...get().items] });
      },

      remove(variantId) {
        set({ items: get().items.filter((it) => it.variantId !== variantId) });
      },

      setQuantity(variantId, quantity) {
        // quantity ≤ 0 эквивалентно remove — явное, ожидаемое поведение
        // для input'ов в UI (пользователь очистил поле).
        if (!Number.isFinite(quantity) || quantity <= 0) {
          set({ items: get().items.filter((it) => it.variantId !== variantId) });
          return;
        }
        const clamped = clampQty(quantity);
        set({
          items: get().items.map((it) =>
            it.variantId === variantId ? { ...it, quantity: clamped } : it,
          ),
        });
      },

      inc(variantId) {
        set({
          items: get().items.map((it) =>
            it.variantId === variantId ? { ...it, quantity: clampQty(it.quantity + 1) } : it,
          ),
        });
      },

      dec(variantId) {
        const current = get().items.find((it) => it.variantId === variantId);
        if (!current) return;
        if (current.quantity <= 1) {
          set({ items: get().items.filter((it) => it.variantId !== variantId) });
          return;
        }
        set({
          items: get().items.map((it) =>
            it.variantId === variantId ? { ...it, quantity: it.quantity - 1 } : it,
          ),
        });
      },

      clear() {
        // При полной очистке корзины промо тоже сбрасываем — иначе
        // «фантомный» applied промо останется в новом сеансе.
        set({ items: [], appliedPromo: null });
      },

      openSheet() {
        set({ isOpen: true });
      },

      closeSheet() {
        set({ isOpen: false });
      },

      setSheetOpen(open) {
        set({ isOpen: open });
      },

      setPromo(promo) {
        set({ appliedPromo: promo });
      },

      clearPromo() {
        set({ appliedPromo: null });
      },

      _reset() {
        set({ items: [], hydrated: false, isOpen: false, appliedPromo: null });
      },
    }),
    {
      name: CART_STORAGE_KEY,
      version: CART_VERSION,
      storage: createJSONStorage(() => localStorage),
      // items + appliedPromo идут в storage; action'ы / hydrated / isOpen — нет.
      partialize: (s) => ({ items: s.items, appliedPromo: s.appliedPromo }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

// ===== Селекторы (pure) ======================================================

export function selectItems(s: CartState): CartItem[] {
  return s.items;
}

/** Общее количество единиц (sum quantity). Подходит для бейджа в Header. */
export function selectTotalItems(s: CartState): number {
  return s.items.reduce((sum, it) => sum + it.quantity, 0);
}

/** Количество уникальных позиций (line items). */
export function selectItemCount(s: CartState): number {
  return s.items.length;
}

/** Subtotal корзины в тийнах. */
export function selectSubtotalCents(s: CartState): number {
  return s.items.reduce((sum, it) => sum + it.priceCents * it.quantity, 0);
}

/** Subtotal одной строки. */
export function selectLineSubtotalCents(item: CartItem): number {
  return item.priceCents * item.quantity;
}

/**
 * SSR-safe hook для компонентов, читающих cart-state в Header/Sheet:
 * до rehydrate возвращает default, после — реальный selector-результат.
 */
export function useCartHydrated(): boolean {
  return useCart((s) => s.hydrated);
}
