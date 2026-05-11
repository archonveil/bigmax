"use client";

import { useRouter } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";
import type { ProductCardDTO } from "@/server/catalog";

interface SearchBoxProps {
  className?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/**
 * Строка поиска в шапке: при вводе 2+ символов — debounced fetch в /api/search,
 * dropdown с топ-8 подсказками. Enter / клик по "Показать все" → /search?q=...
 *
 * Запрос к API живёт в stateе: защищаемся от out-of-order ответов счётчиком
 * `requestId` (старый ответ игнорируем, если пришёл после нового).
 */
export function SearchBox({ className }: SearchBoxProps): JSX.Element {
  const t = useTranslations("search");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductCardDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_CHARS;
  const canSearch = trimmed.length >= MIN_CHARS;

  // Debounced fetch — отменяем предыдущий таймер при каждом вводе.
  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    setLoading(true);
    const id = ++requestIdRef.current;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      const controller = new AbortController();
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results: ProductCardDTO[] }) => {
          if (requestIdRef.current !== id) return;
          setResults(Array.isArray(data.results) ? data.results : []);
          setLoading(false);
          setHighlight(-1);
        })
        .catch(() => {
          if (requestIdRef.current !== id) return;
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [trimmed, canSearch]);

  // Клик вне — закрываем dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function submitFull(q: string = trimmed): void {
    if (!q) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}` as never);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) {
      if (e.key === "Enter" && canSearch) {
        e.preventDefault();
        submitFull();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % (results.length + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? results.length : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = highlight >= 0 && highlight < results.length ? results[highlight] : null;
      if (picked) {
        setOpen(false);
        router.push(`/product/${picked.slug}` as never);
      } else if (canSearch) {
        submitFull();
      }
    }
  }

  const showDropdown =
    open && (canSearch || tooShort) && (loading || results.length > 0 || canSearch || tooShort);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={t("placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[26rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {tooShort ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("hintMinChars")}</p>
          ) : loading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("noResults", { q: trimmed })}
            </p>
          ) : (
            <>
              <ul className="space-y-0.5">
                {results.map((p, idx) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={highlight === idx}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => {
                        setOpen(false);
                        router.push(`/product/${p.slug}` as never);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors",
                        highlight === idx ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                      )}
                    >
                      <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
                        <ProductImage
                          src={p.imageUrl}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{localized(p, "name", locale)}</span>
                        {p.brandName ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {p.brandName}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex-shrink-0 text-sm font-semibold text-primary">
                        {formatCurrencyUzs(p.minPriceCents, locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                role="option"
                aria-selected={highlight === results.length}
                onMouseEnter={() => setHighlight(results.length)}
                onClick={() => submitFull()}
                className={cn(
                  "mt-1 flex w-full items-center justify-center rounded-sm border-t px-2 py-2 text-sm font-medium text-primary transition-colors",
                  highlight === results.length ? "bg-accent" : "hover:bg-accent",
                )}
              >
                {t("showAll")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
