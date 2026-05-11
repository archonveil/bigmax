/**
 * FF-011 · per-flag role gate.
 *
 * Pure helper, который определяет какой роли (admin / manager) разрешено
 * менять конкретный feature-key. Захардкожен в коде (как `feature-risk.ts`)
 * — добавление нового правила = code-review, не SQL UPDATE. Это сознательное
 * решение: governance-rules не должны редактироваться той же страницей,
 * которая зависит от них.
 *
 * Текущая политика:
 *  - `loyalty.*` → ТОЛЬКО `admin` (money-flow flags: spend kill-switch,
 *    earn percent — финансовый риск, требует senior-level).
 *  - все остальные → `admin` или `manager` (контент-флаги: banner, и т.п.).
 *
 * UI должен подавлять submit'ы / toggles для unauthorized role'й заранее,
 * чтобы избежать «нажал → 403». API всё равно делает финальный server-side
 * check как defense-in-depth.
 */

import type { AdminRole } from "@/server/admin-auth";

/**
 * True если данная роль может менять данный feature-key.
 */
export function canChangeFeature(role: AdminRole, key: string): boolean {
  if (key.startsWith("loyalty.")) {
    return role === "admin";
  }
  return true;
}
