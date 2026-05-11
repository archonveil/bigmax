/**
 * Zustand-store избранного (F7). Persist в `localStorage` под ключом
 * `bigmax:favorites`.
 *
 * Решения:
 *   - Snapshot `FavoriteItem` (вместо голого productId) — чтобы рендерить
 *     `/favorites` offline + без похода в API при каждом рендере карточки.
 *   - Уникальность — по `productId` (Favorite.user_id+product_id @@unique
 *     на сервере).
 *   - Для гостя store single-source-of-truth. Для auth-юзера серверная
 *     Favorite-таблица — источник; после login делаем merge-sync через
 *     `/api/favorites/sync` (см. hook useFavoritesSync).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const FAVORITES_STORAGE_KEY = "bigmax:favorites";
export const FAVORITES_VERSION = 1;

export interface FavoriteItem {
  productId: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  brandName: string | null;
  imageUrl: string | null;
  minPriceCents: number;
  /** ms epoch — «recently added on top» в UI. */
  addedAt: number;
}

export type FavoriteItemInput = Omit<FavoriteItem, "addedAt">;

interface FavoritesState {
  items: FavoriteItem[];
  hydrated: boolean;
}

interface FavoritesActions {
  add(item: FavoriteItemInput): void;
  remove(productId: string): void;
  /** Добавляет, если нет; удаляет, если есть. Возвращает новое состояние. */
  toggle(item: FavoriteItemInput): "added" | "removed";
  has(productId: string): boolean;
  clear(): void;
  /** Replace-all — для server-sync (результат `/api/favorites/sync`). */
  setItems(items: FavoriteItem[]): void;
  _reset(): void;
}

export type FavoritesStore = FavoritesState & FavoritesActions;

export const useFavorites = create<FavoritesStore>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,

      add(input) {
        if (get().items.some((it) => it.productId === input.productId)) return;
        const next: FavoriteItem = { ...input, addedAt: Date.now() };
        set({ items: [next, ...get().items] });
      },

      remove(productId) {
        set({ items: get().items.filter((it) => it.productId !== productId) });
      },

      toggle(input) {
        const exists = get().items.some((it) => it.productId === input.productId);
        if (exists) {
          set({ items: get().items.filter((it) => it.productId !== input.productId) });
          return "removed";
        }
        const next: FavoriteItem = { ...input, addedAt: Date.now() };
        set({ items: [next, ...get().items] });
        return "added";
      },

      has(productId) {
        return get().items.some((it) => it.productId === productId);
      },

      clear() {
        set({ items: [] });
      },

      setItems(items) {
        set({ items });
      },

      _reset() {
        set({ items: [], hydrated: false });
      },
    }),
    {
      name: FAVORITES_STORAGE_KEY,
      version: FAVORITES_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

// ===== Селекторы ============================================================

export function selectFavoriteItems(s: FavoritesState): FavoriteItem[] {
  return s.items;
}

export function selectFavoritesCount(s: FavoritesState): number {
  return s.items.length;
}

export function useFavoritesHydrated(): boolean {
  return useFavorites((s) => s.hydrated);
}
