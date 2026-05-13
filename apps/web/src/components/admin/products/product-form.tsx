"use client";

/**
 * `<ProductForm>` (P6-T3) — общая форма create + edit.
 *
 * Multilingual поля рендерятся в `<Tabs>` ru/uz/en — admin переключается
 * между локалями вкладками, не скроллит. Slug и атрибуты-метаданные —
 * в общем (не-табируемом) разделе сверху.
 *
 * Submit:
 *   - create: POST `/api/admin/products` → 201 → router.push на `/admin/products/{id}`.
 *   - edit:   PATCH `/api/admin/products/{id}` → 200 → router.refresh.
 *
 * Server-side ошибки маппятся через `errors.{reason}` i18n-ключи.
 */

import type { Locale } from "@bigmax/shared-types";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { AttributeValue, CategoryAttributeConfig } from "@/catalog/category-attributes";
import { extractColorOptions } from "@/catalog/category-attributes";
import { CategoryAttributesEditor } from "@/components/admin/products/category-attributes-editor";
import { ProductImagesOverview } from "@/components/admin/products/product-images-overview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyFromRuButton, LocaleFallbackHint } from "@/components/ui/locale-fallback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Quick-create dialogs — heavy (Tabs / Select / form state). Splitting them
// into separate JS chunks via next/dynamic shrinks the initial product-form
// bundle; chunks load lazily on hydration.
const QuickAttributeDialog = dynamic(
  () =>
    import("@/components/admin/products/quick-attribute-dialog").then(
      (m) => m.QuickAttributeDialog,
    ),
  { ssr: false },
);
const QuickBrandDialog = dynamic(
  () => import("@/components/admin/products/quick-brand-dialog").then((m) => m.QuickBrandDialog),
  { ssr: false },
);
const QuickCategoryDialog = dynamic(
  () =>
    import("@/components/admin/products/quick-category-dialog").then((m) => m.QuickCategoryDialog),
  { ssr: false },
);
import { slugify } from "@/lib/slugify";
import type { AdminProductDetail, AdminProductDictionaries } from "@/server/admin-products";

/**
 * Sentinel-value для `+ Создать` SelectItem'а внутри dropdown'ов категории
 * и бренда. В onValueChange перехватываем и открываем соответствующий
 * QuickCreate-диалог вместо записи value в форму.
 */
const ADD_NEW_SENTINEL = "__add_new__";

interface FlatCategory {
  id: string;
  nameRu: string;
  slug: string;
  parentId: string | null;
  order: number;
  depth: number;
}

/**
 * Сортирует категории в порядке tree-traversal (root → children → ...).
 * Каждая возвращённая запись несёт `depth` для отступа в UI.
 */
function flattenCategoryTree(
  categories: ReadonlyArray<{
    id: string;
    nameRu: string;
    slug: string;
    parentId: string | null;
    order: number;
  }>,
): FlatCategory[] {
  const childrenByParent = new Map<string | null, (typeof categories)[number][]>();
  for (const c of categories) {
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.order - b.order || a.nameRu.localeCompare(b.nameRu));
  }
  const out: FlatCategory[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number): void => {
    const list = childrenByParent.get(parentId) ?? [];
    for (const c of list) {
      // Cycle guard: если category хитро ссылается на родителя из своего поддерева,
      // выходим без рекурсии.
      if (visited.has(c.id) || depth > 16) continue;
      visited.add(c.id);
      out.push({ ...c, depth });
      visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  // Орфаны (parentId указывает на категорию вне набора) — добавляем как root.
  for (const c of categories) {
    if (!visited.has(c.id)) {
      out.push({ ...c, depth: 0 });
      visited.add(c.id);
    }
  }
  return out;
}

type Mode = "create" | "edit";

interface ProductFormProps {
  mode: Mode;
  /** Для edit-режима — initial values. */
  product?: AdminProductDetail;
  dictionaries: AdminProductDictionaries;
  /** Map<categoryId, configs[]> — pre-fetched в server-page'е. При смене
   *  категории просто берём массив по новому id. */
  attributesByCategory: Record<string, CategoryAttributeConfig[]>;
  locale: Locale;
}

interface FormState {
  categoryId: string;
  brandId: string; // "" = no brand
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  descriptionRu: string;
  descriptionUz: string;
  descriptionEn: string;
  ageFromMonths: string;
  ageToMonths: string;
  gender: "unisex" | "boy" | "girl";
  isActive: boolean;
  isFeatured: boolean;
  /** Категория-специфичные атрибуты — `Record<string, primitive | string[]>`
   *  (string[] для multiselect-kind'а). В submit'е сериализуется в JSON.
   *  При смене категории не сбрасываем — backend silent-ignores unknown keys. */
  attributes: Record<string, AttributeValue>;
}

function initialState(p?: AdminProductDetail, dictionaries?: AdminProductDictionaries): FormState {
  return {
    categoryId: p?.categoryId ?? dictionaries?.categories[0]?.id ?? "",
    brandId: p?.brandId ?? "",
    slug: p?.slug ?? "",
    nameRu: p?.nameRu ?? "",
    nameUz: p?.nameUz ?? "",
    nameEn: p?.nameEn ?? "",
    descriptionRu: p?.descriptionRu ?? "",
    descriptionUz: p?.descriptionUz ?? "",
    descriptionEn: p?.descriptionEn ?? "",
    ageFromMonths:
      p?.ageFromMonths !== null && p?.ageFromMonths !== undefined ? String(p.ageFromMonths) : "",
    ageToMonths:
      p?.ageToMonths !== null && p?.ageToMonths !== undefined ? String(p.ageToMonths) : "",
    gender: p?.gender ?? "unisex",
    isActive: p?.isActive ?? true,
    isFeatured: p?.isFeatured ?? false,
    attributes: p?.attributes ?? {},
  };
}

export function ProductForm({
  mode,
  product,
  dictionaries,
  attributesByCategory,
  locale,
}: ProductFormProps): JSX.Element {
  const t = useTranslations("admin.products.form");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => initialState(product, dictionaries));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Локальный кеш только что созданных категорий/брендов/атрибутов — чтобы
  // admin увидел новый item сразу, без `router.refresh()`. На следующей
  // навигации server-cache invalidate'ится и dictionaries перечитаются.
  const [extraCategories, setExtraCategories] = useState<
    Array<{
      id: string;
      nameRu: string;
      slug: string;
      parentId: string | null;
      order: number;
    }>
  >([]);
  const [extraBrands, setExtraBrands] = useState<Array<{ id: string; name: string; slug: string }>>(
    [],
  );
  // Optimistic attribute configs, keyed by categoryId. Parent тут хранит
  // только что созданные атрибуты — editor мерджит с server-side configs.
  const [extraAttrConfigs, setExtraAttrConfigs] = useState<
    Record<string, CategoryAttributeConfig[]>
  >({});
  // Merge server dictionaries with optimistic local inserts, dedup by id —
  // после router.refresh() свежие dictionaries уже включают новые записи,
  // нельзя их дублировать из extra*-state'а. Server wins, optimistic-only
  // entries (ещё не дотянулись до server'а) — сохраняем.
  const allCategories = (() => {
    const seen = new Set<string>();
    const out: typeof dictionaries.categories = [];
    for (const c of dictionaries.categories) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    for (const c of extraCategories) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  })();
  const allBrands = (() => {
    const seen = new Set<string>();
    const out: typeof dictionaries.brands = [];
    for (const b of dictionaries.brands) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
    }
    for (const b of extraBrands) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
    }
    return out;
  })();
  // Flatten categories into tree-order (root → indented children) for the
  // Select dropdown — admin видит иерархию, не выбирает «Бодики» думая
  // что это top-level.
  const categoryTree = flattenCategoryTree(allCategories);
  // Quick-create dialog open state — открываем программно через sentinel-
  // value `__add_new__` SelectItem (он внутри dropdown'а).
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [brandDialogOpen, setBrandDialogOpen] = useState(false);
  // Auto-slug: пока user не правил slug руками, изменения в `nameRu`
  // подставляют slug через `slugify`. Edit-mode стартует с touched=true
  // (slug уже задан и должен быть стабильным).
  const [slugTouched, setSlugTouched] = useState(() => Boolean(product?.slug));

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const onNameRuChange = (v: string): void => {
    setState((s) => ({
      ...s,
      nameRu: v,
      slug: slugTouched ? s.slug : slugify(v, { separator: "-", maxLength: 128 }),
    }));
  };

  const onSlugChange = (v: string): void => {
    const cleaned = v.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlugTouched(cleaned.length > 0);
    setState((s) => ({ ...s, slug: cleaned }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const body = {
      categoryId: state.categoryId,
      brandId: state.brandId === "" ? null : state.brandId,
      slug: state.slug,
      nameRu: state.nameRu,
      nameUz: state.nameUz,
      nameEn: state.nameEn,
      descriptionRu: state.descriptionRu === "" ? null : state.descriptionRu,
      descriptionUz: state.descriptionUz === "" ? null : state.descriptionUz,
      descriptionEn: state.descriptionEn === "" ? null : state.descriptionEn,
      ageFromMonths: state.ageFromMonths === "" ? null : Number.parseInt(state.ageFromMonths, 10),
      ageToMonths: state.ageToMonths === "" ? null : Number.parseInt(state.ageToMonths, 10),
      gender: state.gender,
      isActive: state.isActive,
      isFeatured: state.isFeatured,
      attributes: Object.keys(state.attributes).length > 0 ? state.attributes : null,
    };

    try {
      const url = mode === "create" ? "/api/admin/products" : `/api/admin/products/${product!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as { id: string };
        if (mode === "create") {
          toast.success(t("successCreate"));
          router.push(`/admin/products/${data.id}`);
        } else {
          toast.success(t("successUpdate"));
          router.refresh();
        }
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      const key = errBody.message ?? errBody.reason ?? "generic";
      setError(translateError(key, t));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = useConfirm();
  const onDelete = async (): Promise<void> => {
    if (!product) return;
    if (
      !(await confirm({
        description: t("deleteConfirm"),
        variant: "destructive",
        confirmLabel: t("delete"),
      }))
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          deleted?: boolean;
          deactivated?: boolean;
        };
        if (body.deleted) {
          toast.success(t("successDelete"));
          router.push("/admin/products");
        } else {
          toast.success(t("successDeactivate"));
          router.refresh();
        }
      } else {
        const errBody = (await res.json().catch(() => ({}))) as { reason?: string };
        setError(translateError(errBody.reason ?? "generic", t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="product-form">
      {/* Не-локалезависимые поля */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="category">{t("fields.category")}</Label>
          <Select
            value={state.categoryId}
            onValueChange={(v) => {
              if (v === ADD_NEW_SENTINEL) {
                setCategoryDialogOpen(true);
                return;
              }
              update("categoryId", v);
            }}
            disabled={submitting}
          >
            <SelectTrigger id="category" data-testid="product-form-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={ADD_NEW_SENTINEL}
                data-testid="product-form-category-add"
                className="mb-1 border-b border-border bg-accent/30 font-medium text-primary focus:bg-accent/60"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t("fields.categoryCreate")}
                </span>
              </SelectItem>
              {categoryTree.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span style={{ paddingLeft: `${c.depth * 14}px` }}>
                    {c.depth > 0 ? (
                      <span aria-hidden className="mr-1 text-muted-foreground">
                        └
                      </span>
                    ) : null}
                    {c.nameRu}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <QuickCategoryDialog
            parents={allCategories.map((c) => ({ id: c.id, nameRu: c.nameRu }))}
            open={categoryDialogOpen}
            onOpenChange={setCategoryDialogOpen}
            onCreated={(c) => {
              // Optimistic-only: новой категории нет attribute-config'ов;
              // server rebuild не нужен. На след. навигации dictionaries
              // подхватят свежие данные через server-cache invalidation.
              setExtraCategories((prev) => [...prev, { ...c, parentId: null, order: 9999 }]);
              update("categoryId", c.id);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="brand" optional>
            {t("fields.brand")}
          </FieldLabel>
          <Select
            value={state.brandId === "" ? "__none__" : state.brandId}
            onValueChange={(v) => {
              if (v === ADD_NEW_SENTINEL) {
                setBrandDialogOpen(true);
                return;
              }
              update("brandId", v === "__none__" ? "" : v);
            }}
            disabled={submitting}
          >
            <SelectTrigger id="brand" data-testid="product-form-brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={ADD_NEW_SENTINEL}
                data-testid="product-form-brand-add"
                className="mb-1 border-b border-border bg-accent/30 font-medium text-primary focus:bg-accent/60"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t("fields.brandCreate")}
                </span>
              </SelectItem>
              <SelectItem value="__none__">{t("fields.brandNone")}</SelectItem>
              {allBrands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <QuickBrandDialog
            open={brandDialogOpen}
            onOpenChange={setBrandDialogOpen}
            onCreated={(b) => {
              // Optimistic-only — bond у бренда с product'ами не fetch'ится
              // на этой странице; full RSC re-render не нужен.
              setExtraBrands((prev) => [...prev, b]);
              update("brandId", b.id);
            }}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="slug">{t("fields.slug")}</Label>
          <Input
            id="slug"
            data-testid="product-form-slug"
            required
            minLength={2}
            maxLength={128}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
            value={state.slug}
            onChange={(e) => onSlugChange(e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">{t("fields.slugHint")}</p>
        </div>
      </section>

      {/* Multilingual поля в табах */}
      <Tabs defaultValue="ru" className="space-y-3">
        <TabsList data-testid="product-form-tabs">
          <TabsTrigger value="ru">{t("tabs.ru")}</TabsTrigger>
          <TabsTrigger value="uz">{t("tabs.uz")}</TabsTrigger>
          <TabsTrigger value="en">{t("tabs.en")}</TabsTrigger>
        </TabsList>
        <TabsContent value="ru" className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="nameRu" required>
              {t("fields.nameRu")}
            </FieldLabel>
            <Input
              id="nameRu"
              data-testid="product-form-name-ru"
              required
              minLength={2}
              maxLength={200}
              value={state.nameRu}
              onChange={(e) => onNameRuChange(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="descRu" optional>
              {t("fields.descriptionRu")}
            </FieldLabel>
            <textarea
              id="descRu"
              data-testid="product-form-desc-ru"
              maxLength={8000}
              value={state.descriptionRu}
              onChange={(e) => update("descriptionRu", e.target.value)}
              disabled={submitting}
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
            />
          </div>
        </TabsContent>
        <TabsContent value="uz" className="space-y-3">
          <div className="flex justify-end">
            <CopyFromRuButton
              onCopy={() =>
                setState((s) => ({
                  ...s,
                  nameUz: s.nameRu,
                  descriptionUz: s.descriptionRu,
                }))
              }
              disabled={submitting}
              testId="product-form-copy-from-ru-uz"
            />
          </div>
          <LocaleFallbackHint />
          <div className="space-y-1.5">
            <FieldLabel htmlFor="nameUz" optional>
              {t("fields.nameUz")}
            </FieldLabel>
            <Input
              id="nameUz"
              data-testid="product-form-name-uz"
              maxLength={200}
              value={state.nameUz}
              onChange={(e) => update("nameUz", e.target.value)}
              disabled={submitting}
              placeholder={state.nameRu}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="descUz" optional>
              {t("fields.descriptionUz")}
            </FieldLabel>
            <textarea
              id="descUz"
              data-testid="product-form-desc-uz"
              maxLength={8000}
              value={state.descriptionUz}
              onChange={(e) => update("descriptionUz", e.target.value)}
              disabled={submitting}
              placeholder={state.descriptionRu}
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
            />
          </div>
        </TabsContent>
        <TabsContent value="en" className="space-y-3">
          <div className="flex justify-end">
            <CopyFromRuButton
              onCopy={() =>
                setState((s) => ({
                  ...s,
                  nameEn: s.nameRu,
                  descriptionEn: s.descriptionRu,
                }))
              }
              disabled={submitting}
              testId="product-form-copy-from-ru-en"
            />
          </div>
          <LocaleFallbackHint />
          <div className="space-y-1.5">
            <FieldLabel htmlFor="nameEn" optional>
              {t("fields.nameEn")}
            </FieldLabel>
            <Input
              id="nameEn"
              data-testid="product-form-name-en"
              maxLength={200}
              value={state.nameEn}
              onChange={(e) => update("nameEn", e.target.value)}
              disabled={submitting}
              placeholder={state.nameRu}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="descEn" optional>
              {t("fields.descriptionEn")}
            </FieldLabel>
            <textarea
              id="descEn"
              data-testid="product-form-desc-en"
              maxLength={8000}
              value={state.descriptionEn}
              onChange={(e) => update("descriptionEn", e.target.value)}
              disabled={submitting}
              placeholder={state.descriptionRu}
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Картинки товара — read-only overview. Upload и edit доступны ТОЛЬКО
          через variant-edit dialog (внизу страницы). Здесь показываем что
          уже привязано, с badge'ами «какому варианту принадлежит». */}
      {product ? (
        <ProductImagesOverview
          images={product.images}
          variants={product.variants}
          locale={locale}
          colorOptions={extractColorOptions(attributesByCategory[state.categoryId] ?? [])}
        />
      ) : null}

      {/* Категория-специфичные атрибуты (DB-driven). + Создать атрибут — в
          header секции, привязан к выбранной категории. */}
      <CategoryAttributesEditor
        configs={(() => {
          // Merge server-driven configs with optimistic local additions,
          // dedup by `key` (server wins, optimistic-only kept).
          const base = attributesByCategory[state.categoryId] ?? [];
          const extras = extraAttrConfigs[state.categoryId] ?? [];
          if (extras.length === 0) return base;
          const seen = new Set(base.map((c) => c.key));
          const onlyNew = extras.filter((c) => !seen.has(c.key));
          return [...base, ...onlyNew];
        })()}
        value={state.attributes}
        onChange={(next) => update("attributes", next)}
        locale={locale}
        disabled={submitting}
        {...(allCategories.find((c) => c.id === state.categoryId)?.nameRu
          ? {
              categoryName: allCategories.find((c) => c.id === state.categoryId)?.nameRu ?? "",
            }
          : {})}
        {...(state.categoryId !== ""
          ? {
              footerAction: (
                <QuickAttributeDialog
                  categoryId={state.categoryId}
                  onCreated={(config) => {
                    // Optimistic — appen the synthesized config to the editor's
                    // configs so the new field renders immediately, without RSC
                    // refresh. Next page navigation will pick up authoritative
                    // server data thanks to cache invalidation in the API route.
                    setExtraAttrConfigs((prev) => ({
                      ...prev,
                      [state.categoryId]: [...(prev[state.categoryId] ?? []), config],
                    }));
                  }}
                  trigger={
                    <button
                      type="button"
                      data-testid="product-form-attribute-add-cta"
                      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                          <Plus className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">
                            {t("attributes.addCtaTitle", {
                              category:
                                allCategories.find((c) => c.id === state.categoryId)?.nameRu ?? "",
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("attributes.addCtaSubtitle")}
                          </p>
                        </div>
                      </div>
                      <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground sm:inline">
                        {t("attributes.addCtaHint")}
                      </span>
                    </button>
                  }
                />
              ),
            }
          : {})}
      />

      {/* Метаданные: возраст / пол / флаги */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="ageFrom" optional>
            {t("fields.ageFrom")}
          </FieldLabel>
          <Input
            id="ageFrom"
            data-testid="product-form-age-from"
            type="number"
            min={0}
            max={240}
            value={state.ageFromMonths}
            onChange={(e) => update("ageFromMonths", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="ageTo" optional>
            {t("fields.ageTo")}
          </FieldLabel>
          <Input
            id="ageTo"
            data-testid="product-form-age-to"
            type="number"
            min={0}
            max={240}
            value={state.ageToMonths}
            onChange={(e) => update("ageToMonths", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">{t("fields.gender")}</Label>
          <Select
            value={state.gender}
            onValueChange={(v) => update("gender", v as FormState["gender"])}
            disabled={submitting}
          >
            <SelectTrigger id="gender" data-testid="product-form-gender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unisex">{t("fields.genderUnisex")}</SelectItem>
              <SelectItem value="boy">{t("fields.genderBoy")}</SelectItem>
              <SelectItem value="girl">{t("fields.genderGirl")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="product-active"
            data-testid="product-form-active"
            checked={state.isActive}
            onCheckedChange={(v) => update("isActive", v === true)}
            disabled={submitting}
          />
          <Label htmlFor="product-active" className="cursor-pointer text-sm font-normal">
            {t("fields.isActive")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="product-featured"
            data-testid="product-form-featured"
            checked={state.isFeatured}
            onCheckedChange={(v) => update("isFeatured", v === true)}
            disabled={submitting}
          />
          <Label htmlFor="product-featured" className="cursor-pointer text-sm font-normal">
            {t("fields.isFeatured")}
          </Label>
        </div>
      </section>

      {error ? (
        <p className="text-sm text-destructive" data-testid="product-form-error">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={submitting} data-testid="product-form-submit">
          {submitting ? t("submitting") : mode === "create" ? t("submitCreate") : t("submit")}
        </Button>
        {mode === "edit" && product ? (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => void onDelete()}
            data-testid="product-form-delete"
          >
            {t("delete")}
          </Button>
        ) : null}
      </footer>
    </form>
  );
}

function translateError(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.products.form">>,
): string {
  const known = [
    "name_ru_too_short",
    "name_uz_too_short",
    "name_en_too_short",
    "name_too_long",
    "slug_too_short",
    "slug_too_long",
    "slug_invalid",
    "slug_exists",
    "category_required",
    "age_range_invalid",
    "invalid_relation",
    "invalid_body",
    "attribute_type_mismatch",
    "attribute_enum_value_invalid",
    "attribute_range_negative",
    "attribute_range_below_min",
    "attribute_range_above_max",
    "attribute_required_missing",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(`errors.${key as (typeof known)[number]}`);
  }
  return t("errors.generic");
}
