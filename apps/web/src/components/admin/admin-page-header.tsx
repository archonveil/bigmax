/**
 * `<AdminPageHeader>` — единая шапка для admin list-pages: заголовок,
 * подзаголовок (опц.) и зона CTA справа (например, кнопка «Создать»).
 *
 * Используется через children: левый блок (title + subtitle) рендерится
 * автоматически, в `actions` положите кнопки.
 */

import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  /** Правая зона: кнопки create / экспорт / etc. */
  actions?: ReactNode;
}

export function AdminPageHeader({ title, subtitle, actions }: Props): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
