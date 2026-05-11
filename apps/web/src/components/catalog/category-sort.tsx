"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  DEFAULT_PRODUCT_SORT,
  isProductSort,
  PRODUCT_SORT_OPTIONS,
  type ProductSort,
} from "@/catalog/sort";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterUrl } from "@/lib/use-filter-url";

interface CategorySortProps {
  value: ProductSort;
}

/**
 * Меняет `?sort=...`, сбрасывает `?page=1`, сохраняет все остальные
 * query-параметры (фильтры, pageSize). Дефолт `featured` удаляется из URL.
 */
export function CategorySort({ value }: CategorySortProps): JSX.Element {
  const t = useTranslations("catalog.sort");
  const searchParams = useSearchParams();
  const { applyParams, isPending } = useFilterUrl();

  function handleChange(next: string): void {
    if (!isProductSort(next)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_PRODUCT_SORT) {
      params.delete("sort");
    } else {
      params.set("sort", next);
    }
    params.delete("page");
    applyParams(params);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}</span>
      <Select value={value} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="h-9 w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {t(`options.${opt}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
