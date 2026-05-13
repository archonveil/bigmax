"use client";

/**
 * `<CategoryTree>` (P6-T4 follow-up) — закрывает все 3 «Открытых вопроса»:
 *
 * (a) **Drag-and-drop reorder** — корневой уровень дерева сортируется через
 *     `@dnd-kit/sortable`. Drop триггерит POST `/api/admin/categories/reorder`
 *     с массивом `{id, order}` (массив строится по индексу после reorder).
 *     Дочерние категории внутри родителя — пока только визуально nested,
 *     reorder работает на одном уровне за раз.
 *
 * (b) **Hierarchical tree-view** — рекурсивный рендер по `parentId`.
 *     Каждый уровень добавляет padding-left для визуальной иерархии.
 *
 * (c) **Bulk-deactivate/activate** — у каждой строки чекбокс. Над таблицей
 *     bar показывает count выбранных + кнопки Activate/Deactivate.
 *     POST `/api/admin/categories/bulk` с `{ids, action}`.
 */

import { Link } from "@bigmax/i18n/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { AdminCategoryItem } from "@/server/admin-taxonomy";

interface TreeNode extends AdminCategoryItem {
  depth: number;
  children: TreeNode[];
}

/** Строит forest (массив корней) из плоского списка по `parentId`. */
function buildForest(items: AdminCategoryItem[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  items.forEach((it) => byId.set(it.id, { ...it, depth: 0, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((it) => {
    const node = byId.get(it.id)!;
    if (it.parentId && byId.has(it.parentId)) {
      const parent = byId.get(it.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // Внутри каждого уровня уже отсортировано server'ом по (order, nameRu).
  // Но depth мы выставляем «зеркально» от parent — нужен второй проход.
  const fixDepth = (n: TreeNode, d: number): void => {
    n.depth = d;
    n.children.forEach((c) => fixDepth(c, d + 1));
  };
  roots.forEach((r) => fixDepth(r, 0));
  return roots;
}

export function CategoryTree({ items }: { items: AdminCategoryItem[] }): JSX.Element {
  const t = useTranslations("admin.categories.list");
  const tBulk = useTranslations("admin.categories.bulk");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Forest для рендера + state с rootIds для drag-reorder.
  const forest = useMemo(() => buildForest(items), [items]);
  const [rootIds, setRootIds] = useState<string[]>(() => forest.map((n) => n.id));

  // Если items пришёл новый список (после router.refresh), синхронизируем.
  // Sync через useMemo dependency: id'шники items.
  const itemsKey = items.map((i) => i.id).join(",");
  useMemo(() => {
    setRootIds(forest.map((n) => n.id));
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const rootById = useMemo(() => {
    const m = new Map<string, TreeNode>();
    forest.forEach((n) => m.set(n.id, n));
    return m;
  }, [forest]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = rootIds.indexOf(String(active.id));
    const newIdx = rootIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(rootIds, oldIdx, newIdx);
    setRootIds(next);
    // POST с новым order'ом по индексу.
    try {
      const res = await fetch("/api/admin/categories/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: next.map((id, i) => ({ id, order: i })),
        }),
      });
      if (res.ok) {
        toast.success(tBulk("reorderSuccess"));
        router.refresh();
      } else {
        toast.error(tBulk("reorderError"));
        setRootIds(rootIds); // rollback
      }
    } catch {
      toast.error(tBulk("reorderError"));
      setRootIds(rootIds);
    }
  };

  const toggleSelect = (id: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(new Set(items.map((it) => it.id)));
  };

  const clearSelection = (): void => {
    setSelected(new Set());
  };

  const confirm = useConfirm();
  const onBulk = async (action: "deactivate" | "activate"): Promise<void> => {
    if (selected.size === 0 || submitting) return;
    if (!(await confirm({ description: tBulk("bulkConfirm") }))) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/categories/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      if (res.ok) {
        const body = (await res.json()) as { updated: number };
        toast.success(tBulk("bulkSuccess", { count: body.updated }));
        clearSelection();
        router.refresh();
      } else {
        toast.error(tBulk("reorderError")); // переиспользуем
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Рендерим в порядке rootIds (DnD), для каждого root — children рекурсивно.
  const sortedRoots = rootIds.map((id) => rootById.get(id)).filter(Boolean) as TreeNode[];

  return (
    <div className="space-y-3" data-testid="admin-categories-tree">
      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-accent/30 p-3"
          data-testid="admin-categories-bulk-bar"
        >
          <span className="text-sm font-medium">{tBulk("selected", { count: selected.size })}</span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onBulk("deactivate")}
              disabled={submitting}
              data-testid="bulk-deactivate"
            >
              {tBulk("bulkDeactivate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onBulk("activate")}
              disabled={submitting}
              data-testid="bulk-activate"
            >
              {tBulk("bulkActivate")}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection} disabled={submitting}>
              {tBulk("clear")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{tBulk("dragHint")}</p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="admin-categories-table">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">
                <input
                  type="checkbox"
                  data-testid="bulk-select-all"
                  aria-label={tBulk("selectAll")}
                  checked={selected.size === items.length && items.length > 0}
                  onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                />
              </th>
              <th className="px-2 py-2 text-left">{t("table.name")}</th>
              <th className="px-3 py-2 text-left">{t("table.slug")}</th>
              <th className="px-3 py-2 text-right">{t("table.products")}</th>
              <th className="px-3 py-2 text-left">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
                {sortedRoots.flatMap((node) => [
                  <SortableRow
                    key={node.id}
                    node={node}
                    selected={selected}
                    toggleSelect={toggleSelect}
                    listLabels={t}
                  />,
                  // Дети рендерятся сразу после root'а, чтобы визуально
                  // отображать иерархию. Они не drag-able (SortableContext
                  // tracks only `rootIds`), но индентация по `depth` показывает
                  // вложенность.
                  ...renderChildren(node, selected, toggleSelect, t),
                ])}
              </SortableContext>
            </DndContext>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive children render (выносим children в плоские строки таблицы)
// ---------------------------------------------------------------------------

function renderChildren(
  node: TreeNode,
  selected: Set<string>,
  toggle: (id: string, checked: boolean) => void,
  t: ReturnType<typeof useTranslations<"admin.categories.list">>,
): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (const child of node.children) {
    out.push(
      <PlainRow
        key={child.id}
        node={child}
        selected={selected.has(child.id)}
        onToggle={(c) => toggle(child.id, c)}
        listLabels={t}
      />,
    );
    out.push(...renderChildren(child, selected, toggle, t));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row variants
// ---------------------------------------------------------------------------

function SortableRow({
  node,
  selected,
  toggleSelect,
  listLabels,
}: {
  node: TreeNode;
  selected: Set<string>;
  toggleSelect: (id: string, checked: boolean) => void;
  listLabels: ReturnType<typeof useTranslations<"admin.categories.list">>;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid="admin-categories-row"
      data-id={node.id}
      data-depth={node.depth}
    >
      <Cells
        node={node}
        selected={selected.has(node.id)}
        onToggle={(c) => toggleSelect(node.id, c)}
        dragHandle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
            data-testid="drag-handle"
            aria-label="reorder"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        }
        listLabels={listLabels}
      />
    </tr>
  );
}

function PlainRow({
  node,
  selected,
  onToggle,
  listLabels,
}: {
  node: TreeNode;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  listLabels: ReturnType<typeof useTranslations<"admin.categories.list">>;
}): JSX.Element {
  return (
    <tr data-testid="admin-categories-row" data-id={node.id} data-depth={node.depth}>
      <Cells node={node} selected={selected} onToggle={onToggle} listLabels={listLabels} />
    </tr>
  );
}

function Cells({
  node,
  selected,
  onToggle,
  dragHandle,
  listLabels,
}: {
  node: TreeNode;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  dragHandle?: JSX.Element;
  listLabels: ReturnType<typeof useTranslations<"admin.categories.list">>;
}): JSX.Element {
  return (
    <>
      <td className="px-2 py-2">
        <input
          type="checkbox"
          data-testid="row-checkbox"
          aria-label={`select ${node.nameRu}`}
          checked={selected}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2" style={{ paddingLeft: `${node.depth * 1.25}rem` }}>
          {dragHandle ?? (
            <span className="inline-block w-4 text-muted-foreground" aria-hidden>
              {node.depth > 0 ? "└" : ""}
            </span>
          )}
          <Link
            href={`/admin/categories/${node.id}`}
            className="font-medium text-primary hover:underline"
          >
            {node.nameRu}
          </Link>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{node.slug}</td>
      <td className="px-3 py-2 text-right font-mono">{node.productCount}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            node.isActive
              ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
              : "bg-slate-100 text-slate-700 ring-slate-200"
          }`}
        >
          {node.isActive ? listLabels("active") : listLabels("inactive")}
        </span>
      </td>
    </>
  );
}
