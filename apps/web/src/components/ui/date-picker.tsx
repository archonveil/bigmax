"use client";

/**
 * `<DatePicker>` — Popover + shadcn `<Calendar>` для выбора одной даты.
 *
 * Контракт удобен для admin-фильтров: `value` хранится как `YYYY-MM-DD`
 * (или ""), а внутрь Calendar'а маппится в Date. На выбор → callback
 * с новым YYYY-MM-DD; clear-кнопка возвращает "".
 *
 * Локаль формата лейбла берётся из `next-intl`. Кнопка clear прячется
 * когда value пустой. Ширина по умолчанию `w-[180px]` — подгоняется под
 * соседние селекты в фильтр-баре.
 */

import { format, parseISO } from "date-fns";
import { enUS, ru, uz } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const LOCALE_MAP = { ru, uz, en: enUS } as const;

interface DatePickerProps {
  /** ISO date string `YYYY-MM-DD` или "" если не выбран. */
  value: string;
  onChange: (value: string) => void;
  /** Прозрачная подпись когда value пустой. */
  placeholder?: string;
  disabled?: boolean;
  /** Минимально допустимая дата (включительно), `YYYY-MM-DD`. */
  min?: string;
  /** Максимально допустимая дата (включительно), `YYYY-MM-DD`. */
  max?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
  testId?: string;
}

function safeParse(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = parseISO(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDate(d: Date): string {
  // Используем localtime YYYY-MM-DD, чтобы исключить ±1-day сдвиг от ISO UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  min,
  max,
  className,
  id,
  ariaLabel,
  testId,
}: DatePickerProps): JSX.Element {
  const t = useTranslations("common");
  const localeKey = useLocale();
  const dateLocale =
    localeKey === "uz" ? LOCALE_MAP.uz : localeKey === "en" ? LOCALE_MAP.en : LOCALE_MAP.ru;

  const selected = safeParse(value);
  const fromDate = safeParse(min);
  const toDate = safeParse(max);

  const display = selected
    ? format(selected, "d MMM yyyy", { locale: dateLocale })
    : (placeholder ?? t("selectDate"));

  return (
    <Popover>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            id={id}
            data-testid={testId}
            disabled={disabled ?? false}
            aria-label={ariaLabel ?? display}
            className={cn(
              "w-full justify-start gap-2 pr-9 font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{display}</span>
          </Button>
        </PopoverTrigger>
        {selected && !disabled ? (
          <button
            type="button"
            aria-label={t("clear")}
            data-testid={testId ? `${testId}-clear` : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange("");
            }}
            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={dateLocale}
          selected={selected}
          {...(fromDate ? { fromDate } : {})}
          {...(toDate ? { toDate } : {})}
          weekStartsOn={1}
          onSelect={(d) => {
            if (!d) return;
            onChange(toIsoDate(d));
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
