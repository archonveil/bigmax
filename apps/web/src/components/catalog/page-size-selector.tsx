"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterUrl } from "@/lib/use-filter-url";
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from "@/server/catalog";

interface PageSizeSelectorProps {
  value: PageSizeOption;
}

/**
 * Меняет `?pageSize=N` и сбрасывает `?page=1`. Другие query-параметры
 * сохраняются — пригодится для фильтров в P2-T3.
 */
export function PageSizeSelector({ value }: PageSizeSelectorProps): JSX.Element {
  const t = useTranslations("catalog.pageSize");
  const searchParams = useSearchParams();
  const { applyParams, isPending } = useFilterUrl();

  function handleChange(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", next);
    params.delete("page");
    applyParams(params);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}</span>
      <Select value={String(value)} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="h-9 w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
