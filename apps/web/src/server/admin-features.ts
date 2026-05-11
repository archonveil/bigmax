/**
 * P7-T2 sub-task G: admin-features query helpers + Zod-схемы.
 *
 * Сейчас в `features` table только seeded row'ы — admin меняет их `value`
 * (но не `key`/`type`/`description`, которые управляются миграциями). Это
 * хороший защитный invariant: код кодирует ожидаемый type per key, admin
 * не может случайно сломать type-contract через UI.
 *
 * Поэтому из CRUD есть только PATCH-value. POST/DELETE приедут позже,
 * когда понадобится admin-managed feature без миграции.
 */

import { prisma, type FeatureType } from "@bigmax/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod-схема
// ---------------------------------------------------------------------------

/**
 * `value` приходит как строка — парсинг по `type` происходит на чтении
 * (getNumberFeature / getBooleanFeature / getStringFeature). Базовая
 * проверка тут: длина и shape per type (server-side double-check за
 * client form UX).
 */
export const FeatureValueUpdateSchema = z
  .object({
    value: z.string().trim().min(0).max(2000),
  })
  .strict();

export type FeatureValueUpdateInput = z.infer<typeof FeatureValueUpdateSchema>;

/**
 * Pure-валидация `value` против ожидаемого `type`. Возвращает discriminated
 * union — caller сразу видит причину отказа без догадок.
 *
 *  - number  → парсится как finite float.
 *  - boolean → ровно `"true"` / `"false"`.
 *  - string  → принимаем любой trim'нутый string, включая пустой (P7-T2
 *    sub-task O: `brand.maintenance_message=""` = banner скрыт; пустая
 *    строка — это легитимное "выключенное" состояние, не ошибка).
 *
 * `empty_string` оставлен в типе error union для будущих use-case'ов
 * (если появится string-feature, где пусто действительно invalid).
 */
export function validateFeatureValue(
  type: FeatureType,
  value: string,
): { ok: true } | { ok: false; reason: "invalid_number" | "invalid_boolean" | "empty_string" } {
  switch (type) {
    case "number": {
      const parsed = Number.parseFloat(value);
      if (!Number.isFinite(parsed)) return { ok: false, reason: "invalid_number" };
      return { ok: true };
    }
    case "boolean": {
      if (value !== "true" && value !== "false") {
        return { ok: false, reason: "invalid_boolean" };
      }
      return { ok: true };
    }
    case "string": {
      // Пустая строка ok — legitimate "off" state для string-feature'ов
      // вроде maintenance banner.
      return { ok: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface AdminFeatureRow {
  key: string;
  value: string;
  type: FeatureType;
  description: string | null;
  updatedAt: Date;
}

/**
 * Список всех features rows. Без pagination — features-таблица должна
 * оставаться маленькой (десятки строк max). Сортировка по `key` для
 * стабильного admin-UI: одинаковый order между рендерами.
 */
export async function getAdminFeatures(): Promise<AdminFeatureRow[]> {
  return prisma.feature.findMany({
    orderBy: { key: "asc" },
    select: {
      key: true,
      value: true,
      type: true,
      description: true,
      updatedAt: true,
    },
  });
}

export async function getAdminFeatureByKey(key: string): Promise<AdminFeatureRow | null> {
  return prisma.feature.findUnique({
    where: { key },
    select: {
      key: true,
      value: true,
      type: true,
      description: true,
      updatedAt: true,
    },
  });
}

// FF-003 high-risk gating — re-export pure helper из client-safe модуля.
// Жил тут изначально, перенесён в `@/lib/feature-risk` чтобы client form
// мог его импортировать без подтягивания Prisma. Re-export сохранён для
// backward compat (admin-features.test.ts + server-side validators).
export { isHighRiskFeatureChange } from "@/lib/feature-risk";

// ---------------------------------------------------------------------------
// FF-002 · per-feature audit timeline
// ---------------------------------------------------------------------------

/**
 * Запись audit-log'а для одного feature-key. Покрывает оба action'а:
 * `feature.updated` (payload содержит `oldValue` + `newValue`) и
 * `feature.cache_invalidated` (только `key` + admin).
 */
export interface FeatureAuditEntry {
  id: string;
  action: "feature.updated" | "feature.cache_invalidated";
  /** Старое значение (только для `feature.updated`). */
  oldValue: string | null;
  /** Новое значение (только для `feature.updated`). */
  newValue: string | null;
  adminEmail: string | null;
  createdAt: Date;
}

/**
 * Limit на per-feature timeline. 20 — компактно, влезает в edit-страницу,
 * покрывает 95 % audit-сценариев. Старше — через `/admin/audit?group=feature`.
 */
export const FEATURE_AUDIT_LIMIT = 20;

/**
 * Читает последние `FEATURE_AUDIT_LIMIT` log-записей для конкретного
 * feature-key. Использует JSON-path filter `request.key = $key` (поддерживается
 * Prisma на Json-столбцах), `+ action` startsWith `feature.`. Индекс
 * `@@index([action])` ускоряет первый шаг; per-key фильтрация после.
 *
 * Возвращает массив в reverse-chronological (новые сверху). Если row PaymentLog
 * пишется без `oldValue` / `newValue` (cache_invalidated action) — поля
 * вернутся `null`.
 */
export async function getFeatureAuditLog(key: string): Promise<FeatureAuditEntry[]> {
  // JSON-path filter работает в Prisma через `Prisma.JsonNullValueFilter`,
  // но проще достать все feature.*-rows и отфильтровать в JS — их немного
  // (audit-log per feature редкий), а Prisma's JSON filtering API
  // нетривиален и не везде надёжно работает.
  const rows = await prisma.paymentLog.findMany({
    where: { action: { startsWith: "feature." } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      action: true,
      request: true,
      createdAt: true,
    },
    // Cap на 200 — даже если у одного key 100+ изменений, нам надо 20.
    // Filter в JS дешёвый.
    take: 200,
  });

  const filtered = rows
    .filter((r) => {
      const req = r.request as Record<string, unknown> | null;
      return req && typeof req === "object" && req["key"] === key;
    })
    .slice(0, FEATURE_AUDIT_LIMIT);

  return filtered.map((r) => {
    const req = r.request as Record<string, unknown>;
    return {
      id: r.id,
      action: r.action as FeatureAuditEntry["action"],
      oldValue:
        typeof req["oldValue"] === "string"
          ? (req["oldValue"] as string)
          : req["oldValue"] !== null && req["oldValue"] !== undefined
            ? String(req["oldValue"])
            : null,
      newValue:
        typeof req["newValue"] === "string"
          ? (req["newValue"] as string)
          : req["newValue"] !== null && req["newValue"] !== undefined
            ? String(req["newValue"])
            : null,
      adminEmail: typeof req["adminEmail"] === "string" ? (req["adminEmail"] as string) : null,
      createdAt: r.createdAt,
    };
  });
}
