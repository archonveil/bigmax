/**
 * P7-T2 sub-task O · `<MaintenanceBanner>` — глобальная плашка-предупреждение.
 *
 * Рендерится в [locale]/layout.tsx ПОСЛЕ <Header>, ДО <main>. Server component,
 * читает `brand.maintenance_message` через Redis-cache (60s TTL).
 *
 * Поведение:
 *  - Пустой message → возвращает `null` (banner не появляется в DOM).
 *  - Непустой → amber pill-banner с иконкой `AlertTriangle` + text.
 *  - aria-live="polite" — screen-reader'ам читается без resharing focus.
 *
 * Reload behaviour: значение читается на каждом SSR-render'е. Cache
 * подхватывает изменения за 60s. Для мгновенного эффекта admin может
 * нажать «Очистить кэш» в [/admin/features/brand.maintenance_message](apps/web/src/app/[locale]/admin/features/[key]/page.tsx).
 */

import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getMaintenanceMessage } from "@/server/maintenance";

export async function MaintenanceBanner(): Promise<JSX.Element | null> {
  const message = await getMaintenanceMessage();
  if (!message) return null;

  const t = await getTranslations("maintenance");

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={t("ariaLabel")}
      data-testid="maintenance-banner"
      className="w-full border-b border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <div className="container flex items-start gap-3 py-3 text-sm text-amber-900 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="leading-relaxed">{message}</p>
      </div>
    </aside>
  );
}
