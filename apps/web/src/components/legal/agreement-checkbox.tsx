"use client";

import { Link } from "@bigmax/i18n/navigation";
import { useId } from "react";

import { Checkbox } from "@/components/ui/checkbox";

interface AgreementCheckboxProps {
  /** Translation key (rich) for the agreement label, e.g. `auth.register.agreementLabel`. */
  label: (chunks: {
    offer: (c: React.ReactNode) => React.ReactNode;
    agreement: (c: React.ReactNode) => React.ReactNode;
    privacy: (c: React.ReactNode) => React.ReactNode;
  }) => React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string | undefined;
}

const linkClass = "underline underline-offset-2 hover:text-primary";

export function AgreementCheckbox({
  label,
  checked,
  onCheckedChange,
  error,
}: AgreementCheckboxProps): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          className="mt-0.5"
          aria-invalid={error ? true : undefined}
        />
        <span className="text-muted-foreground">
          {label({
            offer: (chunks) => (
              <Link className={linkClass} href={"/offer" as never} target="_blank">
                {chunks}
              </Link>
            ),
            agreement: (chunks) => (
              <Link className={linkClass} href={"/agreement" as never} target="_blank">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link className={linkClass} href={"/privacy" as never} target="_blank">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
