"use client";

/**
 * `<RouteProgressBar>` — глобальный top-of-page progress bar (как NProgress).
 *
 * Реализация без внешних зависимостей: watch'им `pathname` + `searchParams`
 * и `useTransition`-pending от `useFilterUrl`-callsite'ов через React state
 * pulse. На любую смену URL эмитим короткую анимацию (≈700ms) — линия
 * заполняется слева направо, потом исчезает. Даёт юзеру визуальную «что-то
 * грузится» feedback'у, не блокируя интерфейс.
 *
 * Кладётся в корневой layout, чтобы покрыть все навигации app-router'а.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Phase = "idle" | "start" | "finish";

export function RouteProgressBar(): JSX.Element {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const firstRender = useRef(true);
  const finishTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Cancel any existing animation timers.
    if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);

    // 1. start phase: bar grows to ~70% in ~300ms.
    setPhase("start");
    // 2. finish phase: bar zips to 100% in ~250ms.
    finishTimer.current = window.setTimeout(() => {
      setPhase("finish");
      // 3. idle: hide and reset.
      idleTimer.current = window.setTimeout(() => {
        setPhase("idle");
      }, 250);
    }, 350);

    return () => {
      if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5",
        phase === "idle" && "opacity-0",
      )}
      data-testid="route-progress"
      data-phase={phase}
    >
      <div
        className={cn(
          "h-full bg-primary shadow-[0_0_8px_rgba(0,0,0,0.12)] transition-[width,opacity] ease-out",
          phase === "start" && "w-[70%] opacity-100 duration-[350ms]",
          phase === "finish" && "w-full opacity-100 duration-[250ms]",
          phase === "idle" && "w-0 opacity-0 duration-[200ms]",
        )}
      />
    </div>
  );
}
