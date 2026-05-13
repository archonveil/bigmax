"use client";

/**
 * `<CategoryAttributeList>` — admin таблица атрибутов одной категории
 * с inline-кнопками reorder (up/down) + edit + delete.
 *
 * Inherited rows (атрибуты, унаследованные от родителя) рендерятся
 * read-only с badge "Наследуется из {parent}" и Edit-кнопкой,
 * которая ведёт в управление атрибутами родительской категории.
 */

import { Link } from "@bigmax/i18n/navigation";
import { ArrowDown, ArrowUp, Lock, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import type { AttributeKind } from "@/catalog/category-attributes";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { AdminCategoryAttributeRow } from "@/server/admin-category-attributes";

export interface InheritedAttribute {
  id: string;
  parentCategoryId: string;
  parentCategoryName: string;
  key: string;
  kind: AttributeKind;
  labelRu: string;
  isRequired: boolean;
  isFilterable: boolean;
}

interface Props {
  categoryId: string;
  initial: AdminCategoryAttributeRow[];
  inherited?: InheritedAttribute[];
}

export function CategoryAttributeList({ categoryId, initial, inherited = [] }: Props): JSX.Element {
  const t = useTranslations("admin.categoryAttributes");
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  if (items.length === 0 && inherited.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="admin-category-attributes-empty"
      >
        {t("empty")}
      </div>
    );
  }

  const move = async (idx: number, direction: -1 | 1): Promise<void> => {
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= items.length || busy) return;
    const reordered = [...items];
    const a = reordered[idx];
    const b = reordered[nextIdx];
    if (!a || !b) return;
    reordered[idx] = b;
    reordered[nextIdx] = a;
    setItems(reordered);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/categories/${categoryId}/attributes/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((r) => r.id) }),
      });
      if (!res.ok) {
        toast.error(t("errors.reorder"));
        setItems(initial);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!(await confirm({ description: t("deleteConfirm"), variant: "destructive" }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/categories/${categoryId}/attributes/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(t("deleted"));
        setItems(items.filter((i) => i.id !== id));
        router.refresh();
      } else {
        toast.error(t("errors.delete"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-16 px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">{t("columns.label")}</th>
            <th className="px-3 py-2 text-left">{t("columns.key")}</th>
            <th className="px-3 py-2 text-left">{t("columns.kind")}</th>
            <th className="px-3 py-2 text-left">{t("columns.required")}</th>
            <th className="px-3 py-2 text-left">{t("columns.filterable")}</th>
            <th className="w-44 px-3 py-2 text-right">{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {inherited.map((it) => (
            <tr
              key={`inh-${it.id}`}
              className="border-t bg-muted/20"
              data-testid={`admin-category-attribute-row-inherited-${it.key}`}
            >
              <td className="px-3 py-2 text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{it.labelRu}</span>
                  <Link
                    href={`/admin/categories/${it.parentCategoryId}/attributes` as never}
                    className="inline-flex w-fit items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground hover:bg-secondary/80"
                  >
                    {t("inheritedFrom", { category: it.parentCategoryName })}
                  </Link>
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{it.key}</td>
              <td className="px-3 py-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {t(`kinds.${it.kind}`)}
                </span>
              </td>
              <td className="px-3 py-2">{it.isRequired ? t("yes") : t("no")}</td>
              <td className="px-3 py-2">{it.isFilterable ? t("yes") : t("no")}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button
                    asChild
                    size="icon"
                    variant="ghost"
                    aria-label={t("editInParent")}
                    title={t("editInParent")}
                  >
                    <Link
                      href={`/admin/categories/${it.parentCategoryId}/attributes/${it.id}` as never}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {items.map((it, i) => (
            <tr
              key={it.id}
              className="border-t"
              data-testid={`admin-category-attribute-row-${it.key}`}
            >
              <td className="px-3 py-2 text-muted-foreground">{inherited.length + i + 1}</td>
              <td className="px-3 py-2 font-medium">{it.labelRu}</td>
              <td className="px-3 py-2 font-mono text-xs">{it.key}</td>
              <td className="px-3 py-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {t(`kinds.${it.kind}`)}
                </span>
              </td>
              <td className="px-3 py-2">{it.isRequired ? t("yes") : t("no")}</td>
              <td className="px-3 py-2">{it.isFilterable ? t("yes") : t("no")}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveUp")}
                    disabled={busy || i === 0}
                    onClick={() => void move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("moveDown")}
                    disabled={busy || i === items.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button asChild size="icon" variant="ghost" aria-label={t("edit")}>
                    <Link href={`/admin/categories/${categoryId}/attributes/${it.id}` as never}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("delete")}
                    disabled={busy}
                    onClick={() => void remove(it.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
