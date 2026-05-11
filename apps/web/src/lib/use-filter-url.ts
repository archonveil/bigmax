"use client";

/**
 * `useFilterUrl` — общий хук для всех страниц с фильтрами.
 *
 * Что делает:
 *  - Использует `router.replace` (по умолчанию) → изменения фильтров НЕ
 *    засоряют историю браузера. Кнопка «Назад» возвращает на страницу
 *    ДО открытия списка, а не на каждую промежуточную URL-комбинацию.
 *  - `scroll: false` — позиция страницы сохраняется при смене фильтра
 *    (юзер не теряет контекст и не «прыгает» вверх).
 *  - Skip-no-op: если querystring не изменился, не дёргаем router'а
 *    вообще (чистый return). Экономит RSC-roundtrip на повторных кликах.
 *  - Wraps в `useTransition` — компонент получает `isPending` для
 *    inline-spinner'ов / disabled-state'ов на форме без лишнего jitter'а.
 *
 * Использование:
 *
 *   const { applyParams, pathname, isPending } = useFilterUrl();
 *   applyParams(buildParams({ status: "low" }));
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

interface UseFilterUrlOptions {
  /** "replace" (default) keeps history clean; "push" inserts a history entry. */
  navigation?: "replace" | "push";
  /** Whether navigation should scroll to top. Default false (preserve filter UX). */
  scroll?: boolean;
}

export interface UseFilterUrlResult {
  pathname: string;
  isPending: boolean;
  /** Applies the given URLSearchParams (relative to current pathname). No-ops
   *  if querystring is identical. */
  applyParams: (params: URLSearchParams) => void;
  /** Convenience: clear all params on the current pathname. */
  clearParams: () => void;
}

export function useFilterUrl(options: UseFilterUrlOptions = {}): UseFilterUrlResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const navigation = options.navigation ?? "replace";
  const scroll = options.scroll ?? false;

  const applyParams = useCallback(
    (params: URLSearchParams): void => {
      const next = params.toString();
      const current = searchParams?.toString() ?? "";
      if (next === current) return; // no-op — skip RSC roundtrip
      const url = next ? `${pathname}?${next}` : pathname;
      startTransition(() => {
        if (navigation === "replace") {
          router.replace(url, { scroll });
        } else {
          router.push(url, { scroll });
        }
      });
    },
    [router, pathname, searchParams, navigation, scroll],
  );

  const clearParams = useCallback((): void => {
    const current = searchParams?.toString() ?? "";
    if (current === "") return;
    startTransition(() => {
      if (navigation === "replace") {
        router.replace(pathname, { scroll });
      } else {
        router.push(pathname, { scroll });
      }
    });
  }, [router, pathname, searchParams, navigation, scroll]);

  return { pathname, isPending, applyParams, clearParams };
}
