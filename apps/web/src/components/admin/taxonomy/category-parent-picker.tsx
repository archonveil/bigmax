"use client";

/**
 * `<CategoryParentPicker>` — popover-based picker для выбора parent-категории.
 *
 * Зачем не Select:
 *  - Категорий может быть много (50+), плоский список теряет иерархию.
 *  - Иерархия (parent/child) — важная информация для admin'а: "это
 *    подкатегория Одежды" видно сразу.
 *  - Поиск по названию ускоряет выбор в большой taxonomy.
 *
 * Состав:
 *  - Trigger: button с текущим выбранным значением (или "— верхний уровень —"
 *    если parentId=null).
 *  - Popover: search input + tree-list.
 *  - Tree рендерится с indentation per depth, кликабельные leaf'ы и parent'ы.
 *  - Search фильтрует с показом всех совпавших узлов; при пустом search
 *    показываем полное дерево.
 *  - "— верхний уровень —" — отдельный pinned-item в начале списка.
 */

import { Check, ChevronDown, FolderTree, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CategoryParentChoice } from "@/server/admin-taxonomy";

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  choices: CategoryParentChoice[];
  disabled?: boolean;
  /** id для linking с FieldLabel htmlFor. */
  id?: string;
}

interface TreeNode extends CategoryParentChoice {
  depth: number;
  hasChildren: boolean;
}

/** Превращает плоский список в DFS-обход дерева с depth-меткой. */
function flattenTree(items: CategoryParentChoice[]): TreeNode[] {
  const childrenByParent = new Map<string | null, CategoryParentChoice[]>();
  for (const c of items) {
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  const out: TreeNode[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    const kids = childrenByParent.get(parentId) ?? [];
    for (const k of kids) {
      const hasChildren = (childrenByParent.get(k.id) ?? []).length > 0;
      out.push({ ...k, depth, hasChildren });
      visit(k.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export function CategoryParentPicker({
  value,
  onChange,
  choices,
  disabled,
  id,
}: Props): JSX.Element {
  const t = useTranslations("admin.categories.form");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => flattenTree(choices), [choices]);

  // Фильтрация: при поиске показываем только matched узлы (без ancestors —
  // в плоском поиске это привычнее, чем показывать всю ветку).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return tree;
    return tree.filter(
      (n) => n.nameRu.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q),
    );
  }, [tree, query]);

  const selected = value ? choices.find((c) => c.id === value) : null;
  const triggerLabel = selected?.nameRu ?? t("fields.parentNone");

  const handleSelect = (next: string | null): void => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
        if (o) setTimeout(() => inputRef.current?.focus(), 50);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="category-parent-trigger"
        >
          <span className="flex items-center gap-2 truncate">
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={selected ? "" : "text-muted-foreground"}>{triggerLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        data-testid="category-parent-popover"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("fields.parentSearch")}
              className="h-8 pl-8 pr-8 text-sm"
              data-testid="category-parent-search"
            />
            {query !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("fields.parentSearchClear")}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        <ul className="max-h-72 overflow-y-auto p-1" data-testid="category-parent-list">
          {/* "Верхний уровень" — pinned. */}
          <li>
            <PickerRow
              isSelected={value === null}
              depth={0}
              onClick={() => handleSelect(null)}
              testId="category-parent-option-none"
            >
              <span className="italic text-muted-foreground">{t("fields.parentNone")}</span>
            </PickerRow>
          </li>

          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("fields.parentNoMatches")}
            </li>
          ) : (
            filtered.map((n) => (
              <li key={n.id}>
                <PickerRow
                  isSelected={value === n.id}
                  depth={query === "" ? n.depth : 0}
                  onClick={() => handleSelect(n.id)}
                  testId={`category-parent-option-${n.slug}`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">
                      <Highlight text={n.nameRu} query={query} />
                    </span>
                    <code className="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                      <Highlight text={n.slug} query={query} />
                    </code>
                  </span>
                </PickerRow>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

interface PickerRowProps {
  isSelected: boolean;
  depth: number;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}

function PickerRow({ isSelected, depth, onClick, testId, children }: PickerRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-selected={isSelected}
      className={[
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      ].join(" ")}
      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary">
        {isSelected ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      </span>
      {children}
    </button>
  );
}
