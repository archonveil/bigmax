/**
 * P6-T8: Admin Customers — pure helpers + Zod schemas + server-fetch'и для
 * управления клиентами в админ-панели.
 *
 * Поддерживаемые операции:
 *  - List: per-page table с filter (q по name/email/phone, role)
 *  - Detail: full profile + orders summary + addresses + loyalty + saved cards
 *  - Role change: customer ↔ manager ↔ admin (with self-demote protection
 *    в endpoint'е — здесь только Zod)
 *  - Password reset: генерация temp-password (12-char alphanum), bcrypt-hash,
 *    запись в БД; возвращается plain в response один раз для admin'а
 *    показать клиенту (через защищённый канал — звонок/SMS).
 *
 * **NB**: блокировка клиента (`isBlocked` flag) — отдельный slot, потребует
 * `User.isBlocked` колонки в schema (см. Открытые вопросы P6-T8).
 */

import { randomBytes } from "node:crypto";

import { type Prisma, prisma } from "@bigmax/db";
import { hash } from "bcryptjs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADMIN_CUSTOMERS_PAGE_SIZE = 20;

const USER_ROLES = ["customer", "manager", "admin"] as const;
type UserRole = (typeof USER_ROLES)[number];

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export interface AdminCustomerListQuery {
  q: string | null;
  role: UserRole | null;
  page: number;
}

export function parseAdminCustomerListQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminCustomerListQuery {
  const raw = searchParams ?? {};
  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 100) : null;

  const roleRaw = pickFirst(raw["role"]);
  const role =
    roleRaw && (USER_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as UserRole) : null;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { q, role, page };
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

export const RoleChangeSchema = z
  .object({
    role: z.enum(USER_ROLES),
    /** Reason для audit. Обязателен для не-customer ролей чтобы admin
     *  не наделил manager'а без объяснения. */
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type RoleChangeInput = z.infer<typeof RoleChangeSchema>;

export const PasswordResetSchema = z
  .object({
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type PasswordResetInput = z.infer<typeof PasswordResetSchema>;

/**
 * Block/unblock — единая schema, режим из URL-segment'а. P6-T8 follow-up (a).
 */
export const BlockToggleSchema = z
  .object({
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type BlockToggleInput = z.infer<typeof BlockToggleSchema>;

/**
 * Bulk role change (P6-T8 follow-up — closes (d)).
 *
 * До 50 пользователей за один запрос. Каждый id обрабатывается через
 * ту же логику что и single-route: self-demote, role_unchanged,
 * forbidden — попадают в `skipped[]`. Sequential processing не нужен
 * (UPDATE-only, без provider-call'ов) — `prisma.$transaction` массовый.
 */
export const RoleBulkSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1).max(50),
    role: z.enum(USER_ROLES),
    reason: z.string().trim().min(3, "reason_too_short").max(500, "reason_too_long"),
  })
  .strict();

export type RoleBulkInput = z.infer<typeof RoleBulkSchema>;

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
//                        ^^^                    ^^                    ^^^^^^^^^
// Исключаем визуально похожие: I/l/1, O/0, чтобы admin диктовал по телефону
// без путаницы. Длина 12 символов → ~71 bits entropy.

/**
 * Генерирует cryptographically random временный пароль 12 символов из
 * безопасного alphabet'а (без I/l/1/O/0). Используется при reset-password
 * admin'ом.
 */
export function generateTempPassword(length = 12): string {
  if (length < 4) throw new Error("temp password length must be ≥ 4");
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * Хэширует password через bcrypt. Cost-factor 10 (стандарт NextAuth).
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, 10);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface AdminCustomerListItem {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: UserRole;
  loyaltyPoints: number;
  language: string;
  isBlocked: boolean;
  ordersCount: number;
  createdAt: Date;
}

export interface AdminCustomerListResult {
  items: AdminCustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminCustomers(
  query: AdminCustomerListQuery,
): Promise<AdminCustomerListResult> {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: "insensitive" as const } },
            { phone: { contains: query.q } },
            { name: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * ADMIN_CUSTOMERS_PAGE_SIZE;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ADMIN_CUSTOMERS_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        role: true,
        loyaltyPoints: true,
        language: true,
        isBlocked: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: users.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      role: u.role as UserRole,
      loyaltyPoints: u.loyaltyPoints,
      language: u.language,
      isBlocked: u.isBlocked,
      ordersCount: u._count.orders,
      createdAt: u.createdAt,
    })),
    total,
    page: query.page,
    pageSize: ADMIN_CUSTOMERS_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_CUSTOMERS_PAGE_SIZE)),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface AdminCustomerOrderSummary {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  currency: string;
  createdAt: Date;
}

export interface AdminCustomerAddressSummary {
  id: string;
  region: string;
  city: string;
  district: string | null;
  street: string | null;
  house: string | null;
  apartment: string | null;
  isDefault: boolean;
}

export interface AdminCustomerLoyaltyTx {
  id: string;
  points: number;
  type: string;
  orderNumber: string | null;
  createdAt: Date;
}

export interface AdminCustomerSavedCard {
  id: string;
  panLast4: string;
  brand: string;
  isDefault: boolean;
  isBlocked: boolean;
}

export interface AdminCustomerDetail {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: UserRole;
  language: string;
  loyaltyPoints: number;
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Counters across all related entities — для быстрого превью. */
  ordersCount: number;
  addressesCount: number;
  totalSpentCents: number;
  /** Last-N для UI секций. */
  recentOrders: AdminCustomerOrderSummary[];
  addresses: AdminCustomerAddressSummary[];
  loyaltyTxs: AdminCustomerLoyaltyTx[];
  savedCards: AdminCustomerSavedCard[];
}

export async function getAdminCustomer(id: string): Promise<AdminCustomerDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      phone: true,
      name: true,
      role: true,
      language: true,
      loyaltyPoints: true,
      isBlocked: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { orders: true, addresses: true } },
      orders: {
        select: {
          id: true,
          number: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      addresses: {
        select: {
          id: true,
          region: true,
          city: true,
          district: true,
          street: true,
          house: true,
          apartment: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      },
      loyaltyTxs: {
        select: {
          id: true,
          points: true,
          type: true,
          createdAt: true,
          order: { select: { number: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      savedCards: {
        select: {
          id: true,
          panLast4: true,
          brand: true,
          isDefault: true,
          isBlocked: true,
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!user) return null;

  // total-spent — параллельный aggregate query, чтобы не таскать orderRows
  // целиком.
  const totalSpent = await prisma.order.aggregate({
    where: {
      userId: id,
      status: { in: ["confirmed", "packing", "shipped", "delivered"] },
    },
    _sum: { totalCents: true },
  });

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
    role: user.role as UserRole,
    language: user.language,
    loyaltyPoints: user.loyaltyPoints,
    isBlocked: user.isBlocked,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ordersCount: user._count.orders,
    addressesCount: user._count.addresses,
    // Prisma `_sum` на BigInt-колонке возвращает bigint в runtime'е, а
    // дальше по цепочке formatCurrencyUzs/centsToSum это упадёт. Coerce'им.
    totalSpentCents: totalSpent._sum.totalCents === null ? 0 : Number(totalSpent._sum.totalCents),
    recentOrders: user.orders,
    addresses: user.addresses,
    loyaltyTxs: user.loyaltyTxs.map((tx) => ({
      id: tx.id,
      points: tx.points,
      type: tx.type,
      orderNumber: tx.order?.number ?? null,
      createdAt: tx.createdAt,
    })),
    savedCards: user.savedCards,
  };
}
