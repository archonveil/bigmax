"use client";

/**
 * `<CollapsibleCatalogAside>` — full-height card-обёртка над содержимым
 * каталога-sidebar'а (CategoryTreeNav + CategoryFilters) с независимым
 * scroll'ом и persisted-collapse'ом в localStorage (`bigmax:catalog-aside-open`).
 *
 * **Layout:**
 *  - На lg+ aside занимает полную высоту viewport-видимой части секции
 *    (`lg:h-[calc(100vh-7rem)]`) и sticky-фиксируется при scroll'е страницы.
 *  - Внутри — flex-column: shrink-0 toolbar сверху + flex-1 overflow-y-auto
 *    body. Это даёт независимую прокрутку sidebar'а от страницы.
 *  - На мобильном sidebar стекается выше grid'а с natural-height (без sticky/
 *    scroll'а).
 *
 * **Hydration-safe state:**
 *  - SSR-render: open=true (без mounted-state — иначе flash of empty sidebar).
 *  - После mount читаем localStorage и применяем persisted state.
 *  - Toolbar показывается только после hydration (избегаем CLS).
 */

import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "bigmax:catalog-aside-open";

interface Props {
  children: ReactNode;
}

export function CollapsibleCatalogAside({ children }: Props): JSX.Element {
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const t = useTranslations("catalog.treeNav");

  useEffect(() => {
    setHydrated(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "false") setOpen(false);
    } catch {
      // localStorage недоступен — остаёмся на default.
    }
  }, []);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    } catch {
      // best-effort persist.
    }
  };

  if (!open) {
    // Collapsed: тонкая sticky-кнопка вместо полного aside.
    return (
      <button
        type="button"
        onClick={toggle}
        title={t("showSidebar")}
        aria-label={t("showSidebar")}
        className={cn(
          "group sticky top-24 inline-flex h-9 w-9 items-center justify-center self-start rounded-md border bg-card text-muted-foreground shadow-sm transition-colors",
          "hover:border-primary/40 hover:text-primary",
        )}
        data-testid="catalog-aside-open"
        data-open="false"
      >
        <PanelLeftOpen className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border bg-card",
        // На lg+ aside фиксируется по высоте viewport'а и sticky'ится. Внутри
        // toolbar = shrink-0, body = flex-1 overflow-y-auto → независимый
        // scroll'ить только sidebar.
        "lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)] lg:w-[300px]",
      )}
      data-testid="catalog-aside"
      data-open="true"
    >
      {/* Toolbar — фиксирован сверху (не скроллится с body). Только кнопка
          «Скрыть»; слева — декоративная иконка-маркер для визуального баланса.
          Заголовки секций ниже («Категории», «Фильтры») сами говорят что
          здесь, дублирующее «Каталог» убрано. */}
      {hydrated ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-gradient-to-br from-primary/5 via-card to-card px-3 py-2">
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggle}
            title={t("toggleSidebar")}
            aria-label={t("toggleSidebar")}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            data-testid="catalog-aside-close"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : null}
      {/* Body — scrollable container для секций. На lg+ scroll работает
          через flex-1 + overflow-y-auto. На мобильном — естественный height
          (overflow visible), весь содержимый поток. */}
      <div className="space-y-3 p-3 lg:flex-1 lg:overflow-y-auto">{children}</div>
    </aside>
  );
}
