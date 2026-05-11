"use client";

import { localized, type Locale } from "@bigmax/shared-types";
import { Clock, MapPin, Phone } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import type { Branch } from "@/components/checkout/checkout-page";
import { cn } from "@/lib/utils";

// Карта рендерится только на клиенте: Leaflet напрямую трогает `window`,
// из-за чего SSR валится на first paint. Никаких placeholder'ов — пустой
// div держит layout до гидратации.
const BranchMap = dynamic(() => import("@/components/checkout/branch-map"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="h-full w-full animate-pulse rounded-md bg-muted"
      style={{ minHeight: 320 }}
    />
  ),
});

interface BranchPickerProps {
  branches: Branch[];
  value: string;
  onChange: (id: string) => void;
  locale: Locale;
}

export function BranchPicker({
  branches,
  value,
  onChange,
  locale,
}: BranchPickerProps): JSX.Element {
  const t = useTranslations("checkout.delivery.branch");

  if (branches.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {t("noBranches")}
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
      <ul role="radiogroup" aria-label={t("selectHint")} className="space-y-2">
        {branches.map((b) => (
          <li key={b.id}>
            <BranchCard
              branch={b}
              selected={b.id === value}
              onSelect={() => onChange(b.id)}
              locale={locale}
            />
          </li>
        ))}
      </ul>

      <div className="overflow-hidden rounded-md border bg-muted/30">
        <BranchMap branches={branches} selectedId={value} onSelect={onChange} />
      </div>
    </div>
  );
}

interface BranchCardProps {
  branch: Branch;
  selected: boolean;
  onSelect: () => void;
  locale: Locale;
}

function BranchCard({ branch, selected, onSelect, locale }: BranchCardProps): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary bg-primary/5" : "border-input hover:border-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        <MapPin
          className={cn(
            "mt-0.5 h-4 w-4 flex-shrink-0",
            selected ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">{localized(branch, "name", locale)}</p>
          <p className="text-xs text-muted-foreground">{localized(branch, "address", locale)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {branch.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" aria-hidden />
                <a
                  href={`tel:${branch.phone}`}
                  className="hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {branch.phone}
                </a>
              </span>
            ) : null}
            {branch.workingHours ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {branch.workingHours}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
