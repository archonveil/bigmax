"use client";

/**
 * Shadcn-style `<Calendar>` — обёртка над `react-day-picker` v8.
 *
 * Caption-row выложен flex'ом: prev | dropdowns (Month / Year) | next.
 * Dropdowns кастомные — на shadcn `<Select>` (через `components.Dropdown`),
 * чтобы UI был консистентным с остальной админкой и не было дубликата
 * текстового заголовка (caption_label hidden через `display:none`).
 *
 * Year-диапазон по умолчанию: 5 лет назад … 1 год вперёд от текущего.
 */

import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { DayPicker, type DayPickerProps, type DropdownProps } from "react-day-picker";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CalendarProps = DayPickerProps;

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_FROM_YEAR = CURRENT_YEAR - 5;
const DEFAULT_TO_YEAR = CURRENT_YEAR + 1;

interface OptionLite {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function extractOptions(children: ReactNode): OptionLite[] {
  const out: OptionLite[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)
    )
      return;
    const value = child.props.value;
    if (value === undefined) return;
    out.push({
      value: String(value),
      label: child.props.children,
      ...(child.props.disabled ? { disabled: true } : {}),
    });
  });
  return out;
}

function fireChange(onChange: DropdownProps["onChange"], value: string): void {
  if (!onChange) return;
  // Synthesize a ChangeEvent so DayPicker's internal handler keeps working.
  const evt = {
    target: { value },
  } as unknown as ChangeEvent<HTMLSelectElement>;
  onChange(evt);
}

/**
 * Year-combobox: editable Input слева + chevron-кнопка справа, открывающая
 * Popover со скроллируемым списком годов. Юзер может:
 *  - набрать год руками (Enter / blur коммитит, Escape откатывает);
 *  - кликнуть chevron → попап → выбрать год кликом из списка;
 *  - использовать стрелки вверх/вниз на input'е (native number-step).
 *
 * Out-of-range / non-integer input откатывается на текущее value.
 */
function YearCombobox({
  value,
  onChange,
  options,
  caption,
}: {
  value: number | string | undefined;
  onChange: DropdownProps["onChange"];
  options: OptionLite[];
  caption: ReactNode;
}): JSX.Element {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(value !== undefined ? String(value) : "");
  }, [value]);

  const numericValues = options.map((o) => Number(o.value)).filter((n) => Number.isFinite(n));
  const min = numericValues.length > 0 ? Math.min(...numericValues) : undefined;
  const max = numericValues.length > 0 ? Math.max(...numericValues) : undefined;

  const commit = (): void => {
    const trimmed = draft.trim();
    const n = Number(trimmed);
    const valid =
      Number.isInteger(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
    if (!valid) {
      setDraft(value !== undefined ? String(value) : "");
      return;
    }
    if (String(n) === String(value ?? "")) return;
    fireChange(onChange, String(n));
  };

  const pick = (val: string): void => {
    setOpen(false);
    if (val === String(value ?? "")) return;
    fireChange(onChange, val);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value !== undefined ? String(value) : "");
      inputRef.current?.blur();
    }
  };

  const currentValueStr = value !== undefined ? String(value) : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          aria-label={typeof caption === "string" ? caption : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          className="h-7 w-[88px] py-0 pl-2 pr-7 text-xs font-medium"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={typeof caption === "string" ? `${caption} list` : "year list"}
            className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-[110px] p-1" align="end">
        <ul
          role="listbox"
          aria-label={typeof caption === "string" ? caption : undefined}
          className="max-h-60 overflow-y-auto"
        >
          {options.map((opt) => {
            const selected = opt.value === currentValueStr;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground",
                    selected && "bg-accent text-accent-foreground font-medium",
                  )}
                >
                  <span>{opt.label}</span>
                  {selected ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CalendarDropdown({
  name,
  value,
  onChange,
  children,
  caption,
}: DropdownProps): JSX.Element {
  const options = extractOptions(children);

  if (name === "years") {
    return <YearCombobox value={value} onChange={onChange} options={options} caption={caption} />;
  }

  // Months → shadcn Select (12 known options, click-to-pick UX).
  const valueStr = value !== undefined ? String(value) : "";
  return (
    <Select value={valueStr} onValueChange={(v) => fireChange(onChange, v)}>
      <SelectTrigger
        aria-label={typeof caption === "string" ? caption : undefined}
        className="h-7 w-fit gap-1 px-2 text-xs font-medium capitalize"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((opt) => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled ?? false}
            className="capitalize"
          >
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown-buttons",
  fromYear = DEFAULT_FROM_YEAR,
  toYear = DEFAULT_TO_YEAR,
  ...props
}: CalendarProps): JSX.Element {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      fromYear={fromYear}
      toYear={toYear}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4 sm:gap-6",
        month: "flex flex-col gap-3",
        // Caption row: prev | dropdowns | next, all on the same axis.
        caption: "flex items-center justify-between gap-2 px-1 pt-1",
        // caption_label still gets emitted by DayPicker in dropdown mode →
        // hide it completely (avoids the duplicate title).
        caption_label: "hidden",
        caption_dropdowns: "flex flex-1 items-center justify-center gap-1.5",
        dropdown_month: "relative",
        dropdown_year: "relative",
        vhidden: "sr-only",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        ),
        nav_button_previous: "",
        nav_button_next: "",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.75rem]",
        row: "flex w-full mt-1",
        cell: cn(
          "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected].day-range-end)]:rounded-r-md",
          "[&:has([aria-selected].day-outside)]:bg-accent/40",
          "[&:has([aria-selected])]:bg-accent",
          "first:[&:has([aria-selected])]:rounded-l-md",
          "last:[&:has([aria-selected])]:rounded-r-md",
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground font-semibold",
        day_outside:
          "day-outside text-muted-foreground/60 aria-selected:bg-accent/40 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground/40 opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className: iconCn }) => (
          <ChevronLeft className={cn("h-4 w-4", iconCn)} aria-hidden />
        ),
        IconRight: ({ className: iconCn }) => (
          <ChevronRight className={cn("h-4 w-4", iconCn)} aria-hidden />
        ),
        Dropdown: CalendarDropdown,
      }}
      {...props}
    />
  );
}
