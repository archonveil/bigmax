"use client";

/**
 * QuickView — комбо-компонент: триггер (overlay-кнопка на карточке) + lazy
 * Dialog. P2-28: сам Dialog (shadcn + Radix portal + VariantPicker +
 * AttributesTable) живёт в отдельном чанке и подгружается через `next/dynamic`
 * только после первого клика. До клика catalog/home pages платят лишь
 * за маленькую кнопку, не за весь modal-tree.
 *
 * Клик по кнопке не должен всплывать вверх к `<Link>` карточки —
 * `stopPropagation`/`preventDefault`, чтобы не улетать на /product/[slug].
 */

import { type Locale } from "@bigmax/shared-types";
import { Eye } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/lib/utils";

const QuickViewDialog = dynamic(() => import("./quick-view-dialog"), {
  ssr: false,
  // Без loading-fallback'а: до первого клика компонент вообще не нужен,
  // а после клика shadcn Dialog сам ставит свой backdrop, пока тянутся
  // данные. Дополнительный skeleton тут только flicker'ит.
  loading: () => null,
});

interface QuickViewProps {
  slug: string;
  locale: Locale;
  /** Класс для floating-кнопки (позиционирование задаёт родитель). */
  buttonClassName?: string;
}

export function QuickView({ slug, locale, buttonClassName }: QuickViewProps): JSX.Element {
  const t = useTranslations("quickView");
  const [open, setOpen] = useState(false);
  // Mount Dialog только после первого клика. Дальше держим mounted чтобы
  // не перефетчить `/api/products/[slug]` на каждом close→open.
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setHasOpened(true);
          setOpen(true);
        }}
        aria-label={t("open")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          buttonClassName,
        )}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        <span>{t("open")}</span>
      </button>

      {hasOpened ? (
        <QuickViewDialog open={open} onOpenChange={setOpen} slug={slug} locale={locale} />
      ) : null}
    </>
  );
}
