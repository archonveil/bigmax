/**
 * `<CategoryTreeNav>` — accordion-навигатор по дереву категорий произвольной
 * глубины.
 *
 * Server component, читает `getCategoryTree()` (cache 10 min, fetches all
 * active rows once + builds nested tree in JS). Использует нативный
 * `<details>` для expand/collapse — нулевой JS, работает с отключённым JS.
 *
 * **Рекурсивная рендеринг-структура:** `<TreeNode>` вызывает себя для каждого
 * `cat.children`. Indentation за счёт `<ul border-l pl-3>` на каждом уровне.
 *
 * **Состояние раскрытости:** узел раскрыт по умолчанию если он = current
 * ИЛИ его потомок = current (определяется через `containsCurrent` рекурсивно).
 *
 * **Подсветка:**
 *  - active self — current category (bold + primary-фон).
 *  - active-ancestor — на пути к current (semibold + accent).
 */

import { Link } from "@bigmax/i18n/navigation";
import { localized, type Locale } from "@bigmax/shared-types";
import { ArrowRight, ChevronDown, LayoutGrid } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import { getCategoryTree, type CategoryNode } from "@/server/catalog";

interface Props {
  /** slug текущей категории; `null` для index-страницы `/catalog`. */
  currentSlug: string | null;
  locale: Locale;
}

/** Pure: true если node или любой его потомок имеет указанный slug. */
function containsCurrent(node: CategoryNode, currentSlug: string | null): boolean {
  if (currentSlug === null) return false;
  if (node.slug === currentSlug) return true;
  return node.children.some((c) => containsCurrent(c, currentSlug));
}

export async function CategoryTreeNav({ currentSlug, locale }: Props): Promise<JSX.Element> {
  const tree = await getCategoryTree();
  const t = await getTranslations("catalog");
  const tNav = await getTranslations("catalog.treeNav");

  return (
    <nav
      aria-label={t("indexTitle")}
      className="rounded-lg border bg-card"
      data-testid="category-tree-nav"
    >
      <header className="border-b px-4 py-3">
        <Link
          href="/catalog"
          className={cn(
            "flex items-center gap-2 text-sm font-semibold transition-colors",
            currentSlug === null ? "text-primary" : "text-foreground hover:text-primary",
          )}
          data-active={currentSlug === null ? "true" : "false"}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          <span>{t("indexTitle")}</span>
        </Link>
      </header>

      <ul className="p-2">
        {tree.map((cat) => (
          <TreeNode
            key={cat.id}
            cat={cat}
            currentSlug={currentSlug}
            locale={locale}
            depth={0}
            labels={{
              openCategory: tNav("openCategory"),
              toggleSubcategories: tNav("toggleSubcategories"),
            }}
          />
        ))}
      </ul>
      <footer className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        {tNav("legend")}
      </footer>
    </nav>
  );
}

/**
 * Рекурсивный node-renderer. **Два чётко отделённых клик-target'а:**
 *  - Левая зона (имя + arrow-right) — ссылка на категорию (`<Link>`).
 *  - Правая зона (chevron-down с border'ом) — toggle accordion (нативный
 *    `<summary>` click); только для категорий с детьми.
 *
 * **Depth-aware sizing для глубокой вложенности:**
 *  - depth 0..1 (root + first nesting) — generous padding (px-3) и chevron (36×36).
 *  - depth >= 2 (deep) — compact (px-2, chevron 32×32) чтобы текст-area не
 *    «съедалась» отступами. Children-ul тоже tightens: ml-3 pl-3 → ml-2 pl-2,
 *    + border-l/60 (полупрозрачная guide-line) — иерархия видна, но визуально
 *    тише.
 */
function TreeNode({
  cat,
  currentSlug,
  locale,
  labels,
  depth,
}: {
  cat: CategoryNode;
  currentSlug: string | null;
  locale: Locale;
  labels: { openCategory: string; toggleSubcategories: string };
  /** 0 = root-level item, increments per nesting level. */
  depth: number;
}): JSX.Element {
  const name = localized(cat, "name", locale);
  const hasChildren = cat.children.length > 0;
  const isActiveSelf = cat.slug === currentSlug;
  const isActiveAncestor =
    !isActiveSelf && currentSlug !== null && containsCurrent(cat, currentSlug);
  const openByDefault = isActiveSelf || isActiveAncestor;

  // Compact'оп начинается с depth=2 (3-я линия вложенности). Двe оси:
  //   `compactSelf` — внутренний padding текущего узла (px-2 вместо px-3).
  //   `compactChildren` — indent для детей текущего узла (ml-2 pl-2 вместо
  //   ml-3 pl-3). Срабатывает на 1 раньше, чтобы дети depth>=2 сразу
  //   попадали в compact-indent (визуальная симметрия: на depth=2 узел
  //   получает И tight indent И tight padding одновременно).
  const compactSelf = depth >= 2;
  const compactChildren = depth >= 1;
  const linkPadX = compactSelf ? "px-2" : "px-3";
  const childUlClasses = compactChildren
    ? "ml-2 mt-1 space-y-0.5 border-l border-border/60 pl-2"
    : "ml-3 mt-1 space-y-0.5 border-l pl-3";

  // Leaf — простая ссылка с arrow в конце.
  if (!hasChildren) {
    return (
      <li>
        <Link
          href={`/catalog/${cat.slug}` as never}
          aria-label={`${name} — ${labels.openCategory}`}
          className={cn(
            "group/leaf flex items-start justify-between gap-2 rounded-md py-1.5 text-sm transition-colors",
            linkPadX,
            isActiveSelf
              ? "bg-primary/10 font-semibold text-primary"
              : "text-foreground/90 hover:bg-accent hover:text-foreground",
          )}
          data-active={isActiveSelf ? "true" : "false"}
          data-depth={depth}
        >
          {/* Имя категории. Wrap'ится на несколько строк — длинные имена
              полностью видны без hover'а/ellipsis'а. `leading-snug` (1.375)
              делает multi-line компактным, `break-words` ломает на любом
              символе если слово не помещается. */}
          <span className="break-words py-0.5 leading-snug">{name}</span>
          <ArrowRight
            className="mt-1.5 h-3.5 w-3.5 shrink-0 opacity-40 transition-all group-hover/leaf:translate-x-0.5 group-hover/leaf:opacity-100"
            aria-hidden
          />
        </Link>
      </li>
    );
  }

  // С children — `<details>` accordion + split-зона.
  return (
    <li>
      <details open={openByDefault} className="group">
        {/* `<summary>` — toggle target. Внутри:
              [Link name + → arrow] ← навигация (anchor priority over toggle)
              [│] vertical separator
              [⌄ chevron with hover button] ← toggle (фон summary'а)
            Браузер делает navigation на anchor-click, toggle — на остальном. */}
        <summary
          className={cn(
            "group/sum flex cursor-pointer list-none items-center gap-0 rounded-md text-sm transition-colors",
            isActiveSelf
              ? "bg-primary/10 font-semibold text-primary"
              : isActiveAncestor
                ? "bg-accent/60 font-semibold text-foreground"
                : "text-foreground/90 hover:bg-accent hover:text-foreground",
          )}
          data-active={isActiveSelf ? "true" : "false"}
          data-active-ancestor={isActiveAncestor ? "true" : "false"}
          data-depth={depth}
          title={labels.toggleSubcategories}
        >
          {/* Левая зона — ссылка-навигация: имя + arrow→. Имя wrap'ится на
              несколько строк, чтобы длинные категории были полностью видны
              (без truncate/ellipsis'а). */}
          <Link
            href={`/catalog/${cat.slug}` as never}
            aria-label={`${name} — ${labels.openCategory}`}
            className={cn(
              "group/link flex min-w-0 flex-1 items-start justify-between gap-2 py-1.5 transition-colors",
              linkPadX,
              "hover:underline hover:decoration-primary/40 hover:underline-offset-2",
            )}
          >
            <span className="break-words py-0.5 leading-snug">{name}</span>
            <ArrowRight
              className="mt-1.5 h-3.5 w-3.5 shrink-0 opacity-40 transition-all group-hover/link:translate-x-0.5 group-hover/link:opacity-100"
              aria-hidden
            />
          </Link>
          {/* Vertical separator + chevron-кнопка. Border + hover-фон даёт
              визуальный «button» аффорданс — ясно что это другой target.
              На deep depth chevron компактнее (32×32 вместо 36×36). */}
          <span aria-hidden className="h-5 w-px bg-border" />
          <span
            aria-hidden
            className={cn(
              "grid shrink-0 place-content-center rounded-r-md text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary group-open:rotate-180 group-open:text-foreground",
              compactSelf ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            <ChevronDown className="h-4 w-4 transition-transform duration-150" aria-hidden />
          </span>
        </summary>
        <ul className={childUlClasses}>
          {cat.children.map((child) => (
            <TreeNode
              key={child.id}
              cat={child}
              currentSlug={currentSlug}
              locale={locale}
              labels={labels}
              depth={depth + 1}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}
