/**
 * P6-T8 follow-up (closes (c)): Admin Audit Log — агрегирует все
 * admin-driven события из `PaymentLog` в одной timeline. Заменяет
 * Postgres-CLI grep'ы на admin-friendly UI.
 *
 * Поддерживаемые actions (зарегистрированы в существующих route-handler'ах):
 *  - `order.status_change` (P6-T5) — admin переводил статус заказа
 *  - `order.shipment_committed` (P6-T7) — отгрузка → quantity decrement
 *  - `order.stock_released` (P6-T7) — cancel/refund → reserved release
 *  - `refund_completed` / `refund_failed` (P6-T6) — Uniteller/COD refund
 *  - `recheck_ok` / `recheck_failed` (P6-T6) — manual pull-status
 *  - `cancel_failed` (P5-T4) — Uniteller cancel ошибка
 *  - `cancel_by_user` (P5-T4) — customer-initiated cancel
 *  - `user.role_change` (P6-T8) — role flip
 *  - `user.password_reset` (P6-T8) — temp-pass генерация
 *  - `user.blocked` / `user.unblocked` (P6-T8 follow-up) — suspension toggle
 *  - `create` (P4-T5) — Uniteller form rendering (Uniteller success path)
 *  - `webhook` (P4-T6) — Uniteller callback ingest
 *  - `status_pull` (P4-T9) — worker pull-status
 *
 * Filter — по action ИЛИ префиксу (например, `user.` ловит role_change +
 * password_reset + blocked + unblocked) + date range.
 */

import { type Prisma, prisma } from "@bigmax/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADMIN_AUDIT_PAGE_SIZE = 50;

/**
 * Группы action'ов с user-friendly label'ами для filter-select'а. Каждая
 * группа — массив prefix'ов (string startsWith match через ILIKE).
 */
export const AUDIT_ACTION_GROUPS = {
  user: ["user."],
  order: ["order."],
  refund: ["refund_"],
  recheck: ["recheck_"],
  cancel: ["cancel_"],
  webhook: ["webhook"],
  // P7-T2 sub-task K: feature.* — admin feature-flag mutations + cache busts.
  feature: ["feature."],
} as const;

type AuditGroup = keyof typeof AUDIT_ACTION_GROUPS;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface AdminAuditQuery {
  group: AuditGroup | null;
  /** Свободное search по `action` ИЛИ `errorMessage` (ILIKE %q%). */
  q: string | null;
  /** ISO date `YYYY-MM-DD` начала (UTC midnight). */
  from: Date | null;
  to: Date | null;
  page: number;
}

export function parseAdminAuditQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): AdminAuditQuery {
  const raw = searchParams ?? {};
  const groupRaw = pickFirst(raw["group"]);
  const group = groupRaw && groupRaw in AUDIT_ACTION_GROUPS ? (groupRaw as AuditGroup) : null;

  const qRaw = pickFirst(raw["q"]);
  const q = qRaw && qRaw.trim() !== "" ? qRaw.trim().slice(0, 100) : null;

  const from = parseDateBoundary(pickFirst(raw["from"]), "start");
  const toEnd = parseDateBoundary(pickFirst(raw["to"]), "end");
  // from > to → обнуляем оба (как в admin-orders).
  const validRange = from && toEnd && from.getTime() > toEnd.getTime() ? false : true;

  const pageRaw = pickFirst(raw["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return {
    group,
    q,
    from: validRange ? from : null,
    to: validRange ? toEnd : null,
    page,
  };
}

function parseDateBoundary(input: string | undefined, kind: "start" | "end"): Date | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const time = kind === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const d = new Date(`${input}${time}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export interface AdminAuditEntry {
  id: string;
  action: string;
  statusCode: number | null;
  errorMessage: string | null;
  request: unknown;
  response: unknown;
  paymentId: string | null;
  createdAt: Date;
}

export interface AdminAuditResult {
  items: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function getAdminAuditLog(query: AdminAuditQuery): Promise<AdminAuditResult> {
  const conditions: Prisma.PaymentLogWhereInput[] = [];

  if (query.group) {
    const prefixes = AUDIT_ACTION_GROUPS[query.group];
    conditions.push({
      OR: prefixes.map((p) => ({ action: { startsWith: p } })),
    });
  }
  if (query.q) {
    conditions.push({
      OR: [
        { action: { contains: query.q, mode: "insensitive" as const } },
        { errorMessage: { contains: query.q, mode: "insensitive" as const } },
      ],
    });
  }
  if (query.from || query.to) {
    conditions.push({
      createdAt: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      },
    });
  }

  const where: Prisma.PaymentLogWhereInput = conditions.length > 0 ? { AND: conditions } : {};
  const skip = (query.page - 1) * ADMIN_AUDIT_PAGE_SIZE;

  const [items, total] = await Promise.all([
    prisma.paymentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ADMIN_AUDIT_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        statusCode: true,
        errorMessage: true,
        request: true,
        response: true,
        paymentId: true,
        createdAt: true,
      },
    }),
    prisma.paymentLog.count({ where }),
  ]);

  return {
    items,
    total,
    page: query.page,
    pageSize: ADMIN_AUDIT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_AUDIT_PAGE_SIZE)),
  };
}
