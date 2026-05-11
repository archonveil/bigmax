/**
 * `<AdminEmptyState>` — единый компонент пустого состояния для admin
 * list-pages. Большой dashed-border блок с иконкой, заголовком и
 * опциональной подсказкой/CTA.
 */

import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  testId?: string;
}

export function AdminEmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  testId,
}: Props): JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center"
      data-testid={testId}
    >
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="max-w-md text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
