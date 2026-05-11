import { Link } from "@bigmax/i18n/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

interface PaginationProps {
  /** Полный pathname без локали и без querystring, например `/catalog/clothing`. */
  basePath: string;
  page: number;
  totalPages: number;
  /** Готовый querystring (без `?`). Поддерживает повторяющиеся ключи (multi-brand). */
  queryString?: string;
}

export async function Pagination({
  basePath,
  page,
  totalPages,
  queryString,
}: PaginationProps): Promise<JSX.Element | null> {
  if (totalPages <= 1) return null;
  const t = await getTranslations("catalog.pagination");

  const prevPage = page - 1;
  const nextPage = page + 1;
  const prevDisabled = prevPage < 1;
  const nextDisabled = nextPage > totalPages;

  const hrefFor = (n: number): string => {
    const params = new URLSearchParams(queryString ?? "");
    params.delete("page");
    if (n !== 1) params.set("page", String(n));
    const q = params.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const linkClass = (disabled: boolean): string =>
    cn(
      "inline-flex h-10 items-center gap-1 rounded-md border bg-background px-4 text-sm font-medium transition-colors",
      disabled ? "pointer-events-none opacity-50" : "hover:bg-accent hover:text-accent-foreground",
    );

  return (
    <nav aria-label="pagination" className="mt-8 flex items-center justify-between gap-4">
      <Link
        aria-disabled={prevDisabled}
        tabIndex={prevDisabled ? -1 : 0}
        href={(prevDisabled ? basePath : hrefFor(prevPage)) as never}
        className={linkClass(prevDisabled)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("prev")}
      </Link>

      <span className="text-sm text-muted-foreground">
        {t("pageOf", { page, total: totalPages })}
      </span>

      <Link
        aria-disabled={nextDisabled}
        tabIndex={nextDisabled ? -1 : 0}
        href={(nextDisabled ? basePath : hrefFor(nextPage)) as never}
        className={linkClass(nextDisabled)}
      >
        {t("next")}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </nav>
  );
}
