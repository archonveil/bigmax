"use client";

import { useEffect, useRef } from "react";

import { useFavorites, useFavoritesHydrated, type FavoriteItem } from "./store";

/**
 * Шлёт POST `/api/favorites/sync` с переданными productIds, заменяет
 * `useFavorites.items` на серверный merged-список. Используется:
 *   - `<FavoritesSync>` на mount (если сессия уже активна);
 *   - `login-form.tsx` сразу после успешного signIn (критично: иначе
 *     mount-once state в `<FavoritesSync>` не пересматривается после
 *     смены сессии — гостевые favorites не попадут на сервер).
 *
 * 401 / сеть → тихо no-op, локальный state остаётся корректным.
 */
export async function syncFavoritesWithServer(
  productIds: string[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productIds }),
    };
    if (signal) init.signal = signal;
    const syncRes = await fetch("/api/favorites/sync", init);
    if (!syncRes.ok) return;
    const data = (await syncRes.json()) as { ok: boolean; items: FavoriteItem[] };
    if (data.ok && Array.isArray(data.items)) {
      useFavorites.getState().setItems(data.items);
    }
  } catch {
    // Network error / aborted — тихо. На следующем visit'е попробуем снова.
  }
}

/**
 * Mount-once хук. После rehydrate `useFavorites` одно-разовый fetch:
 *   1) GET /api/auth/session — есть ли user.id?
 *   2) Если да — `syncFavoritesWithServer(items.map(id))` →
 *      server делает upsert, возвращает финальный merged-список →
 *      `setItems(...)` заменяет локальный state.
 *
 * Итог: гостевые добавления остаются, серверные накладываются сверху.
 * Subsequent add/remove-ы для auth-юзера идут отдельным fire-and-forget
 * POST/DELETE в `/api/favorites` (делает `<FavoriteButton>`).
 *
 * ⚠️ Login → `/` не размонтирует этот компонент → didSyncRef остаётся
 * `true`, и sync не повторится. Для этого login-form вызывает
 * `syncFavoritesWithServer` вручную после signIn.
 *
 * Компонент ничего не рендерит; монтируется один раз в root layout.
 */
export function FavoritesSync(): null {
  const hydrated = useFavoritesHydrated();
  const items = useFavorites((s) => s.items);
  const didSyncRef = useRef(false);

  useEffect(() => {
    if (!hydrated || didSyncRef.current) return;
    didSyncRef.current = true;

    const controller = new AbortController();
    void (async () => {
      try {
        const sessionRes = await fetch("/api/auth/session", { signal: controller.signal });
        if (!sessionRes.ok) return;
        const session = (await sessionRes.json()) as { user?: { id?: string } } | null;
        if (!session?.user?.id) return;
        await syncFavoritesWithServer(
          items.map((it) => it.productId),
          controller.signal,
        );
      } catch {
        // Network error / aborted — тихо.
      }
    })();

    return () => controller.abort();
  }, [hydrated, items]);

  return null;
}
