"use client";

import { useEffect, useState } from "react";

/**
 * `useDebounce(value, delay=200)` — возвращает значение с задержкой.
 * При каждом изменении `value` reset'ит timer; debounced-значение
 * обновляется через `delay` мс после последнего изменения.
 *
 * Используется в admin filter'ах для as-you-type search (push в URL
 * через 200мс после остановки набора, без manual submit).
 */
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
