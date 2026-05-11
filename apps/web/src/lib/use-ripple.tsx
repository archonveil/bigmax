"use client";

/**
 * `useRipple` — Material-style ripple-эффект для кликабельных элементов.
 *
 * Использование:
 *   const { ripples, onPointerDown } = useRipple();
 *   <button onPointerDown={onPointerDown} className="relative overflow-hidden">
 *     {children}
 *     {ripples}
 *   </button>
 *
 * Контейнер должен быть `relative overflow-hidden` чтобы клипать круг.
 * Каждый pointerdown добавляет ripple; через 600мс auto-cleanup.
 *
 * Reduced motion: если пользователь предпочитает уменьшенную анимацию
 * (`prefers-reduced-motion: reduce`), ripple не рендерится — соответствует
 * правилам доступности.
 */

import { useCallback, useState, type PointerEvent } from "react";

interface RippleState {
  id: number;
  x: number;
  y: number;
  size: number;
}

interface UseRippleResult {
  ripples: JSX.Element;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

let counter = 0;

export function useRipple(): UseRippleResult {
  const [ripples, setRipples] = useState<RippleState[]>([]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>): void => {
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) return;
    }
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    // Радиус ripple = расстояние от точки клика до самого дальнего угла
    // кнопки. Это гарантирует полное покрытие за scale(0)→scale(1) —
    // ripple никогда не выходит за границы (никакая overflow-clipped
    // anomalia не имеет значения, физически круг не больше кнопки).
    const dx = Math.max(event.clientX - rect.left, rect.right - event.clientX);
    const dy = Math.max(event.clientY - rect.top, rect.bottom - event.clientY);
    const radius = Math.sqrt(dx * dx + dy * dy);
    const size = radius * 2;
    const x = event.clientX - rect.left - radius;
    const y = event.clientY - rect.top - radius;
    const id = ++counter;
    setRipples((prev) => [...prev, { id, x, y, size }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);
  }, []);

  const node = (
    <span
      aria-hidden
      // `rounded-[inherit]` чтобы overflow-hidden клипал по тому же
      // border-radius'у, что и родительская кнопка. Без этого ripple
      // выходит за углы при scale-transform (transform создаёт новый
      // stacking-context и обходит overflow-clip без явного rounded).
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full bg-current animate-ripple"
          style={{
            left: r.x,
            top: r.y,
            width: r.size,
            height: r.size,
          }}
        />
      ))}
    </span>
  );

  return { ripples: node, onPointerDown };
}
