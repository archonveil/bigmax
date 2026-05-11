"use client";

/**
 * `<DateRangePicker>` — единый Popover + двух-месячный shadcn `<Calendar>`
 * для выбора диапазона дат. Один клик = начало, второй клик = конец.
 *
 * Контракт:
 *  - `from` / `to` — `YYYY-MM-DD` либо "" если не выбран. От `<DatePicker>`
 *    отличается тем, что выбираем сразу два значения за один Popover.
 *  - При выборе только начала (клик 1) — `to` остаётся прежним. Когда
 *    юзер закрывает Popover (или нажимает «Готово» — у нас Apply кнопка
 *    снаружи), state двигается дальше с `from` set, `to` либо новый,
 *    либо старый.
 *  - Inline-кнопка `×` (clear) сбрасывает обе даты на "".
 */

import { format, parseISO } from "date-fns";
import { enUS, ru, uz } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const LOCALE_MAP = { ru, uz, en: enUS } as const;

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
  testId?: string;
}

function safeParse(value: string): Date | undefined {
  if (!value) return undefined;
  const d = parseISO(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  disabled,
  placeholder,
  className,
  id,
  ariaLabel,
  testId,
}: DateRangePickerProps): JSX.Element {
  const t = useTranslations("common");
  const localeKey = useLocale();
  const dateLocale =
    localeKey === "uz" ? LOCALE_MAP.uz : localeKey === "en" ? LOCALE_MAP.en : LOCALE_MAP.ru;

  const fromDate = safeParse(from);
  const toDate = safeParse(to);
  const [open, setOpen] = useState(false);

  const fmt = (d: Date): string => format(d, "d MMM yyyy", { locale: dateLocale });

  let display: string;
  if (fromDate && toDate) display = `${fmt(fromDate)} — ${fmt(toDate)}`;
  else if (fromDate) display = `${fmt(fromDate)} — …`;
  else if (toDate) display = `… — ${fmt(toDate)}`;
  else display = placeholder ?? t("selectDateRange");

  const selected: DateRange | undefined =
    fromDate || toDate ? { from: fromDate, to: toDate } : undefined;

  const onSelect = (range: DateRange | undefined): void => {
    onChange({
      from: range?.from ? toIsoDate(range.from) : "",
      to: range?.to ? toIsoDate(range.to) : "",
    });
  };

  const hasValue = Boolean(fromDate || toDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              !hasValue && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{display}</span>
          </Button>
        </PopoverTrigger>
        {hasValue && !disabled ? (
          <button
            type="button"
            aria-label={t("clear")}
            data-testid={testId ? `${testId}-clear` : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange({ from: "", to: "" });
            }}
            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={dateLocale}
          selected={selected}
          onSelect={onSelect}
          numberOfMonths={2}
          weekStartsOn={1}
          {...(fromDate ? { defaultMonth: fromDate } : {})}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
