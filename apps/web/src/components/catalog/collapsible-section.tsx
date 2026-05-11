"use client";

/**
 * `<CollapsibleSection>` — секция-обёртка внутри каталога-sidebar'а с
 * независимым persist'ом в localStorage (`bigmax:<storageKey>`).
 *
 * Дизайн: разделитель-кнопка сверху (без внешней card-обёртки — родитель
 * `<CollapsibleCatalogAside>` уже даёт card-стиль), под ним body.
 *
 * **Почему `hidden`, а не conditional render:** дети — client-компоненты
 * с локальным state'ом (как `<CategoryFilters>` с form-selection'ами).
 * Unmount на collapse потерял бы выбранные значения. Toggle через `hidden`
 * сохраняет DOM + state, скрывая только визуал.
 *
 * **Hydration-safe:** SSR-default — open=true. После mount читаем
 * localStorage. До hydration toggle disabled — не мигаем neutral'ным
 * состоянием.
 */

import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** Уникальный ключ для localStorage persist. Префиксуется `bigmax:`. */
  storageKey: string;
  /** Заголовок секции. */
  title: string;
  /** Опциональная иконка слева от заголовка. */
  icon?: ReactNode;
  /** Содержимое секции — НЕ unmount'ится при collapse, скрывается через `hidden`. */
  children: ReactNode;
}

export function CollapsibleSection({ storageKey, title, icon, children }: Props): JSX.Element {
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const stored = localStorage.getItem(`bigmax:${storageKey}`);
      if (stored === "false") setOpen(false);
    } catch {
      // localStorage недоступен — остаёмся на default open.
    }
  }, [storageKey]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(`bigmax:${storageKey}`, next ? "true" : "false");
    } catch {
      // best-effort persist.
    }
  };

  return (
    <section
      data-testid={`collapsible-${storageKey}`}
      data-open={open ? "true" : "false"}
      className={cn(
        "overflow-hidden rounded-lg border bg-background transition-shadow",
        open && "shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors",
          // Когда секция открыта — header чуть подсвечен (subtle bg + primary
          // accent на иконке), чтобы было visually-явно "это раскрыто".
          open
            ? "bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10"
            : "hover:bg-accent/40",
          !hydrated && "pointer-events-none",
        )}
        aria-expanded={open}
        aria-controls={`section-${storageKey}`}
      >
        <span className="flex items-center gap-2">
          {icon ? (
            <span
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                open ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {icon}
            </span>
          ) : null}
          <span>{title}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            open ? "rotate-0 text-primary" : "-rotate-90 text-muted-foreground",
          )}
          aria-hidden
        />
      </button>
      <div
        id={`section-${storageKey}`}
        hidden={hydrated && !open}
        className="border-t bg-muted/20 p-3"
      >
        {children}
      </div>
    </section>
  );
}
