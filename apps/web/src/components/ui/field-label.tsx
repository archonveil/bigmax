"use client";

/**
 * `<FieldLabel>` — обёртка над shadcn `<Label>` с явным индикатором
 * required / optional. Цель — единый язык на всех admin-формах:
 *  - red asterisk `*` после required-полей;
 *  - subtle "не обязательно" pill после optional-полей.
 *
 * Без флага рендерит как обычный Label (для случаев когда required
 * подразумевается контекстно — например, в radio-группе).
 */

import { useTranslations } from "next-intl";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** `true` → красная звёздочка после текста. */
  required?: boolean;
  /** `true` → muted "не обязательно" pill после текста. Игнорируется
   *  если `required=true` (взаимоисключающие). */
  optional?: boolean;
  children: React.ReactNode;
}

export function FieldLabel({
  required,
  optional,
  children,
  className,
  ...rest
}: Props): JSX.Element {
  const t = useTranslations("common");
  return (
    <Label className={cn("flex items-center gap-1.5", className)} {...rest}>
      <span>{children}</span>
      {required ? (
        <span className="text-destructive" aria-hidden>
          *
        </span>
      ) : optional ? (
        <span className="rounded-sm bg-muted/70 px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
          {t("optional")}
        </span>
      ) : null}
    </Label>
  );
}
