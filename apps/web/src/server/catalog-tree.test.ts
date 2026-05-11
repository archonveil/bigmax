/**
 * Pure helpers для multi-level category tree:
 *  - buildCategoryTree: flat rows → nested tree.
 *  - collectDescendantIds: root → flat list of IDs (рекурсивно).
 *  - findAncestorChain: tree + targetId → массив ancestors (root → parent).
 *
 * Тестируется на 3-уровневой fixture-tree, edge-cases: orphan-parent,
 * leaf-узлы, root-target, missing target.
 */

import { describe, expect, it } from "vitest";

import { buildCategoryTree, collectDescendantIds, findAncestorChain } from "./catalog";

interface Row {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  parentId: string | null;
}

function mk(id: string, parentId: string | null): Row {
  return { id, slug: id, nameRu: id, nameUz: id, nameEn: id, parentId };
}

/**
 * Fixture: 3-уровневая иерархия.
 *   clothing
 *   ├─ outerwear
 *   │  ├─ jackets
 *   │  └─ coats
 *   └─ shirts
 *   toys
 *   └─ plush
 */
const FIXTURE: Row[] = [
  mk("clothing", null),
  mk("outerwear", "clothing"),
  mk("jackets", "outerwear"),
  mk("coats", "outerwear"),
  mk("shirts", "clothing"),
  mk("toys", null),
  mk("plush", "toys"),
];

describe("buildCategoryTree", () => {
  it("плоский список → nested tree с правильной глубиной", () => {
    const tree = buildCategoryTree(FIXTURE);
    expect(tree).toHaveLength(2); // clothing + toys
    const clothing = tree.find((n) => n.id === "clothing")!;
    expect(clothing.children).toHaveLength(2); // outerwear + shirts
    const outerwear = clothing.children.find((n) => n.id === "outerwear")!;
    expect(outerwear.children).toHaveLength(2); // jackets + coats
    expect(outerwear.children.map((c) => c.id).sort()).toEqual(["coats", "jackets"]);
    const toys = tree.find((n) => n.id === "toys")!;
    expect(toys.children).toHaveLength(1);
    expect(toys.children[0]!.id).toBe("plush");
  });

  it("пустой список → []", () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it("orphan-parent (parentId не существует) → треugnit как root", () => {
    const rows: Row[] = [mk("orphan", "ghost-id"), mk("root", null)];
    const tree = buildCategoryTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.id).sort()).toEqual(["orphan", "root"]);
  });

  it("leaf без детей → пустой children array", () => {
    const tree = buildCategoryTree([mk("leaf", null)]);
    expect(tree[0]!.children).toEqual([]);
  });
});

describe("collectDescendantIds", () => {
  const tree = buildCategoryTree(FIXTURE);

  it("root с глубокой иерархией → всё включая root", () => {
    const ids = collectDescendantIds(tree, "clothing").sort();
    expect(ids).toEqual(["clothing", "coats", "jackets", "outerwear", "shirts"]);
  });

  it("middle-level → root + потомки", () => {
    const ids = collectDescendantIds(tree, "outerwear").sort();
    expect(ids).toEqual(["coats", "jackets", "outerwear"]);
  });

  it("leaf → только сам себя", () => {
    expect(collectDescendantIds(tree, "jackets")).toEqual(["jackets"]);
  });

  it("несуществующий id → массив с одним этим id (defensive)", () => {
    expect(collectDescendantIds(tree, "ghost")).toEqual(["ghost"]);
  });
});

describe("findAncestorChain", () => {
  const tree = buildCategoryTree(FIXTURE);

  it("depth-3 узел → 2 ancestor'а (root → parent), current НЕ включен", () => {
    const chain = findAncestorChain(tree, "jackets");
    expect(chain.map((c) => c.id)).toEqual(["clothing", "outerwear"]);
  });

  it("depth-2 узел → 1 ancestor", () => {
    const chain = findAncestorChain(tree, "outerwear");
    expect(chain.map((c) => c.id)).toEqual(["clothing"]);
  });

  it("root узел → пустой массив", () => {
    expect(findAncestorChain(tree, "clothing")).toEqual([]);
  });

  it("несуществующий id → пустой массив", () => {
    expect(findAncestorChain(tree, "ghost")).toEqual([]);
  });

  it("возвращает CategoryCard-shape (без children/parentId)", () => {
    const [first] = findAncestorChain(tree, "jackets");
    expect(first).toEqual({
      id: "clothing",
      slug: "clothing",
      nameRu: "clothing",
      nameUz: "clothing",
      nameEn: "clothing",
    });
    expect(first).not.toHaveProperty("children");
    expect(first).not.toHaveProperty("parentId");
  });
});
