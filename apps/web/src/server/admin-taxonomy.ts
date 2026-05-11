/**
 * Admin Taxonomy — единый модуль для CRUD трёх resource'ов (P6-T4 §F13):
 *   - Categories (multilingual + tree, parentId nullable)
 *   - Brands (single-name, slug-unique, logo + country opt.)
 *   - StoreBranches (multilingual name+address, geo lat/lng opt.)
 *
 * Shared shape: каждый resource имеет ListItem, Detail, Create/Update Zod
 * + getAll/getOne. SSR-pages импортируют отсюда, API-routes тоже.
 */

import { prisma, type Prisma } from "@bigmax/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const SlugSchema = z
  .string()
  .trim()
  .min(2, "slug_too_short")
  .max(64, "slug_too_long")
  .regex(SLUG_RE, "slug_invalid");

// RU — единственный обязательный язык. UZ/EN опциональны и при пустоте
// fallback'ятся на RU через `pickLocalized` на read-стороне.
const NameTriSchema = {
  nameRu: z.string().trim().min(2, "name_ru_too_short").max(200, "name_too_long"),
  nameUz: z.string().trim().max(200, "name_too_long").optional(),
  nameEn: z.string().trim().max(200, "name_too_long").optional(),
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CategoryBaseSchema = z.object({
  ...NameTriSchema,
  slug: SlugSchema,
  parentId: z.string().min(1).nullable().optional(),
  iconUrl: z.string().trim().max(2048).url("icon_url_invalid").nullable().optional(),
  order: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const CategoryCreateSchema = CategoryBaseSchema;
export type CategoryCreate = z.infer<typeof CategoryCreateSchema>;
export const CategoryUpdateSchema = CategoryBaseSchema.partial();
export type CategoryUpdate = z.infer<typeof CategoryUpdateSchema>;

export interface AdminCategoryItem {
  id: string;
  slug: string;
  nameRu: string;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  order: number;
  productCount: number;
}

export interface AdminCategoryDetail {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  parentId: string | null;
  iconUrl: string | null;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAdminCategories(): Promise<AdminCategoryItem[]> {
  const rows = await prisma.category.findMany({
    orderBy: [{ order: "asc" }, { nameRu: "asc" }],
    select: {
      id: true,
      slug: true,
      nameRu: true,
      parentId: true,
      isActive: true,
      order: true,
      parent: { select: { nameRu: true } },
      _count: { select: { products: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameRu: r.nameRu,
    parentId: r.parentId,
    parentName: r.parent?.nameRu ?? null,
    isActive: r.isActive,
    order: r.order,
    productCount: r._count.products,
  }));
}

export async function getAdminCategory(id: string): Promise<AdminCategoryDetail | null> {
  return prisma.category.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      parentId: true,
      iconUrl: true,
      order: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export interface CategoryParentChoice {
  id: string;
  nameRu: string;
  slug: string;
  parentId: string | null;
}

/** Список категорий для parent-picker (исключая текущую и её детей —
 *  нельзя ссылаться сам на себя или на потомка, иначе получится цикл).
 *  Возвращает плоский массив с `parentId` чтобы клиент мог построить
 *  дерево с indentation в UI. */
export async function getCategoryParentChoices(
  excludeId: string | null,
): Promise<CategoryParentChoice[]> {
  const all = await prisma.category.findMany({
    orderBy: [{ parentId: "asc" }, { order: "asc" }, { nameRu: "asc" }],
    select: { id: true, nameRu: true, slug: true, parentId: true },
  });
  if (!excludeId) return all;
  // Собираем set'ы потомков `excludeId` (включая саму excludeId), чтобы
  // не позволить выбрать их parent'ом.
  const banned = new Set<string>([excludeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parentId && banned.has(c.parentId) && !banned.has(c.id)) {
        banned.add(c.id);
        grew = true;
      }
    }
  }
  return all.filter((c) => !banned.has(c.id));
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

const BrandBaseSchema = z.object({
  name: z.string().trim().min(2, "name_too_short").max(120, "name_too_long"),
  slug: SlugSchema,
  logoUrl: z.string().trim().max(2048).url("logo_url_invalid").nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  country: z.string().trim().max(64).nullable().optional(),
});

export const BrandCreateSchema = BrandBaseSchema;
export type BrandCreate = z.infer<typeof BrandCreateSchema>;
export const BrandUpdateSchema = BrandBaseSchema.partial();
export type BrandUpdate = z.infer<typeof BrandUpdateSchema>;

export interface AdminBrandItem {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  productCount: number;
}

export interface AdminBrandDetail {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  country: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAdminBrands(): Promise<AdminBrandItem[]> {
  const rows = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      country: true,
      _count: { select: { products: true } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    country: b.country,
    productCount: b._count.products,
  }));
}

export async function getAdminBrand(id: string): Promise<AdminBrandDetail | null> {
  return prisma.brand.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      description: true,
      country: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// StoreBranches
// ---------------------------------------------------------------------------

const BranchBaseSchema = z.object({
  ...NameTriSchema,
  /** Стабильный URL-id для интеграций (P6-T7 follow-up). Optional; если
   *  null — branch адресуется через cuid. Unique через DB-индекс. */
  slug: SlugSchema.nullable().optional(),
  addressRu: z.string().trim().min(3, "address_ru_too_short").max(500, "address_too_long"),
  addressUz: z.string().trim().max(500, "address_too_long").optional(),
  addressEn: z.string().trim().max(500, "address_too_long").optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  workingHours: z.string().trim().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const BranchCreateSchema = BranchBaseSchema;
export type BranchCreate = z.infer<typeof BranchCreateSchema>;
export const BranchUpdateSchema = BranchBaseSchema.partial();
export type BranchUpdate = z.infer<typeof BranchUpdateSchema>;

export interface AdminBranchItem {
  id: string;
  nameRu: string;
  addressRu: string;
  phone: string | null;
  isActive: boolean;
  hasGeo: boolean;
}

export interface AdminBranchDetail {
  id: string;
  slug: string | null;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  addressRu: string;
  addressUz: string;
  addressEn: string;
  phone: string | null;
  workingHours: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAdminBranches(): Promise<AdminBranchItem[]> {
  const rows = await prisma.storeBranch.findMany({
    orderBy: [{ isActive: "desc" }, { nameRu: "asc" }],
    select: {
      id: true,
      nameRu: true,
      addressRu: true,
      phone: true,
      isActive: true,
      latitude: true,
      longitude: true,
    },
  });
  return rows.map((b) => ({
    id: b.id,
    nameRu: b.nameRu,
    addressRu: b.addressRu,
    phone: b.phone,
    isActive: b.isActive,
    hasGeo: b.latitude !== null && b.longitude !== null,
  }));
}

export async function getAdminBranch(id: string): Promise<AdminBranchDetail | null> {
  return prisma.storeBranch.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      nameEn: true,
      addressRu: true,
      addressUz: true,
      addressEn: true,
      phone: true,
      workingHours: true,
      latitude: true,
      longitude: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Type re-export for narrower API typing
// ---------------------------------------------------------------------------

export type TaxonomyResource = "categories" | "brands" | "branches";

/** Маппит P2003/P2025 errors в reason-коды через duck-typed code (см. P6-T3 note). */
export function prismaErrorCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err && typeof err.code === "string"
    ? err.code
    : null;
}

export type AnyPrismaPromise = Prisma.PrismaPromise<unknown>;
