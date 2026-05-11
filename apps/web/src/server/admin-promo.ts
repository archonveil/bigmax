/**
 * P7-T1: Admin promo — query helpers + Zod schemas + helper для
 * безопасного инкремента `Promo.usedCount` при захвате платежа.
 *
 * **Реальная цена `usageLimit`**: до P7-T1 поле существовало в схеме,
 * но нигде не инкрементилось → лимит был фиктивным. Теперь:
 *   1. `pay/route.ts` пишет `Order.promoCode` snapshot при создании.
 *   2. webhook Uniteller (и впредь — COD admin-mark-delivered) зовёт
 *      `incrementPromoUsage(tx, order.promoCode)` на первом переходе
 *      `Payment.status → captured`. Идемпотентно по «первой капчуре»
 *      (см. `isFirstCapture` в webhook'е).
 *   3. `updateMany({ where: { code } })` — silent no-op если промо удалён
 *      между checkout'ом и капчурой, чтобы не валить webhook ради audit-следа.
 */

import {
  type Prisma,
  type ExtendedPrismaClient,
  type TransactionClient,
  prisma,
  PromoType as PromoTypeEnum,
} from "@bigmax/db";
import { z } from "zod";

import { PROMO_TYPES } from "@/cart/promo";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

export const ADMIN_PROMO_PAGE_SIZE = 50;

// Конверт `PromoType` (Prisma enum) ↔ `PROMO_TYPES` (узкий union из cart/promo).
// Они должны совпадать набором значений; assert ниже.
const PROMO_TYPE_VALUES = Object.values(PromoTypeEnum) as readonly string[];
if (
  PROMO_TYPES.length !== PROMO_TYPE_VALUES.length ||
  PROMO_TYPES.some((t) => !PROMO_TYPE_VALUES.includes(t))
) {
  throw new Error("PROMO_TYPES / Prisma PromoType drift — sync обязателен");
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * `code` нормализуется в UPPER и валидируется regex'ом. Допустимы латиница,
 * цифры, `_`, `-`. Длина 3..64. Поясняем: UPPER нормализация на сервере
 * совпадает с тем, как UI отправляет (CodeSchema в `/api/promo/validate`).
 */
const CodeField = z
  .string()
  .trim()
  .min(3, "code_too_short")
  .max(64, "code_too_long")
  .regex(/^[A-Za-z0-9_-]+$/, "code_invalid")
  .transform((s) => s.toUpperCase());

const TypeField = z.enum(PROMO_TYPES);

/** ICU-friendly nullable date. Принимаем ISO либо `null`. */
const NullableIsoDate = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional()
  .transform((v) => (v ? new Date(v) : null));

/**
 * Value-семантика зависит от `type`:
 *  - percent → 0..100 (целое; UI рендерит как «%»).
 *  - fixed → тийны (≥ 0); ограничиваем 10^9 чтобы не словить переполнение
 *    при умножении на subtotalCents.
 *  - free_delivery → значение игнорируется бизнес-логикой; принимаем 0.
 */
const ValueField = z.number().int().min(0).max(1_000_000_000);

/** Минимальная сумма заказа (тийны). */
const MinOrderField = z.number().int().min(0).max(1_000_000_000_000);

const UsageLimitField = z.number().int().min(1).max(1_000_000).nullable().optional();

/** Cross-field check для `value` в зависимости от `type`. */
function refineValueByType<T extends { type: string; value: number }>(d: T): boolean {
  if (d.type === "percent") return d.value >= 0 && d.value <= 100;
  return true;
}

/** Cross-field: starts_at < ends_at если оба заданы. */
function refineDateRange<T extends { startsAt: Date | null; endsAt: Date | null }>(d: T): boolean {
  if (d.startsAt && d.endsAt) return d.startsAt.getTime() < d.endsAt.getTime();
  return true;
}

export const PromoCreateSchema = z
  .object({
    code: CodeField,
    type: TypeField,
    value: ValueField,
    minOrderCents: MinOrderField.optional().default(0),
    startsAt: NullableIsoDate,
    endsAt: NullableIsoDate,
    usageLimit: UsageLimitField,
    isActive: z.boolean().optional().default(true),
  })
  .strict()
  .refine(refineValueByType, { path: ["value"], message: "percent_out_of_range" })
  .refine(refineDateRange, { path: ["endsAt"], message: "ends_before_starts" });

export type PromoCreateInput = z.infer<typeof PromoCreateSchema>;

/**
 * Update: все поля опциональны, но если `type` меняется — `value` обязан
 * прийти заново (нельзя оставить старое значение, рассчитанное под другой
 * type). UI-форма всегда шлёт оба, проверка на всякий.
 */
export const PromoUpdateSchema = z
  .object({
    code: CodeField.optional(),
    type: TypeField.optional(),
    value: ValueField.optional(),
    minOrderCents: MinOrderField.optional(),
    startsAt: NullableIsoDate,
    endsAt: NullableIsoDate,
    usageLimit: UsageLimitField,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.type !== undefined && d.value === undefined) return false;
      return true;
    },
    { path: ["value"], message: "value_required_when_type_changes" },
  )
  .refine(
    (d) => {
      if (d.type !== undefined && d.value !== undefined) {
        return refineValueByType({ type: d.type, value: d.value });
      }
      return true;
    },
    { path: ["value"], message: "percent_out_of_range" },
  )
  .refine(
    (d) => {
      if (d.startsAt && d.endsAt) return d.startsAt.getTime() < d.endsAt.getTime();
      return true;
    },
    { path: ["endsAt"], message: "ends_before_starts" },
  );

export type PromoUpdateInput = z.infer<typeof PromoUpdateSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const PROMO_SORTS = [
  "createdAt_desc",
  "createdAt_asc",
  "code_asc",
  "usedCount_desc",
] as const;
export type PromoSort = (typeof PROMO_SORTS)[number];

function isPromoSort(s: string): s is PromoSort {
  return (PROMO_SORTS as readonly string[]).includes(s);
}

export interface AdminPromoListQuery {
  q: string | null;
  /** `null` = без фильтра, `true` = только активные, `false` = только выключенные. */
  activeOnly: boolean | null;
  sort: PromoSort;
  page: number;
}

export function parseAdminPromoListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminPromoListQuery {
  const raw = searchParams ?? {};
  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 64) : null;

  const activeRaw = pickFirst(raw["active"]);
  const activeOnly = activeRaw === "true" ? true : activeRaw === "false" ? false : null;

  const sortRaw = pickFirst(raw["sort"]);
  const sort: PromoSort = sortRaw && isPromoSort(sortRaw) ? sortRaw : "createdAt_desc";

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { q, activeOnly, sort, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export interface AdminPromoListItem {
  id: string;
  code: string;
  type: PromoTypeEnum;
  value: number;
  /** Тийны. Schema хранит как BigInt, но `$extends.result` коэрсит к `number`
   *  на чтении (см. packages/db/src/index.ts header). */
  minOrderCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
}

export interface AdminPromoListResult {
  items: AdminPromoListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminPromos(query: AdminPromoListQuery): Promise<AdminPromoListResult> {
  const where: Prisma.PromoWhereInput = {
    ...(query.q ? { code: { contains: query.q.toUpperCase(), mode: "insensitive" as const } } : {}),
    ...(query.activeOnly !== null ? { isActive: query.activeOnly } : {}),
  };

  const orderBy: Prisma.PromoOrderByWithRelationInput[] = (() => {
    switch (query.sort) {
      case "createdAt_asc":
        return [{ createdAt: "asc" }];
      case "code_asc":
        return [{ code: "asc" }];
      case "usedCount_desc":
        return [{ usedCount: "desc" }, { createdAt: "desc" }];
      case "createdAt_desc":
      default:
        return [{ createdAt: "desc" }];
    }
  })();

  const skip = (query.page - 1) * ADMIN_PROMO_PAGE_SIZE;

  const [items, total] = await Promise.all([
    prisma.promo.findMany({
      where,
      orderBy,
      skip,
      take: ADMIN_PROMO_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        minOrderCents: true,
        startsAt: true,
        endsAt: true,
        usageLimit: true,
        usedCount: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.promo.count({ where }),
  ]);

  return {
    items,
    total,
    page: query.page,
    pageSize: ADMIN_PROMO_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_PROMO_PAGE_SIZE)),
  };
}

export async function getAdminPromoById(id: string): Promise<AdminPromoListItem | null> {
  const row = await prisma.promo.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      type: true,
      value: true,
      minOrderCents: true,
      startsAt: true,
      endsAt: true,
      usageLimit: true,
      usedCount: true,
      isActive: true,
      createdAt: true,
    },
  });
  return row;
}

// ---------------------------------------------------------------------------
// usedCount increment
// ---------------------------------------------------------------------------

/**
 * Атомарный +1 на `Promo.usedCount` для заданного кода (UPPER).
 * Использует `updateMany` чтобы:
 *  - не падать если промо удалили между checkout'ом и капчурой
 *    (snapshot в `Order.promoCode` остаётся в audit-следе);
 *  - не требовать предварительного `findUnique` (одна round-trip).
 *
 * Идемпотентность гарантируется caller'ом — увеличиваем только при
 * первом `pending → captured` переходе (см. `isFirstCapture` в webhook'е).
 *
 * Принимает `tx` (Prisma transaction client) для выполнения внутри
 * атомарного `$transaction([...])` Uniteller webhook'а.
 */
export async function incrementPromoUsage(
  tx: ExtendedPrismaClient | TransactionClient,
  code: string | null | undefined,
): Promise<void> {
  if (!code) return;
  const normalized = code.trim().toUpperCase();
  if (normalized === "") return;
  await tx.promo.updateMany({
    where: { code: normalized },
    data: { usedCount: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Prisma error helper (re-used from taxonomy module pattern)
// ---------------------------------------------------------------------------

export function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return null;
}
