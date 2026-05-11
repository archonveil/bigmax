/**
 * Helpers для admin-API endpoints (P6-T3+). Защита: middleware ловит
 * `/admin/*` (UI-route'ы), но `/api/admin/*` идёт мимо middleware'а
 * matcher'а — поэтому в каждом admin-API route ОБЯЗАТЕЛЬНО зовём
 * `requireAdminSession()` первым делом.
 */

import { NextResponse } from "next/server";

import { auth } from "@/auth";

export type AdminRole = "admin" | "manager";

export type AdminAuthResult =
  | { ok: true; userId: string; role: AdminRole; name: string | null; email: string | null }
  | { ok: false; response: Response };

/**
 * Возвращает либо валидную session (если юзер privileged), либо готовый
 * NextResponse 401/403. Caller'у достаточно: `if (!auth.ok) return auth.response;`.
 */
export async function requireAdminSession(): Promise<AdminAuthResult> {
  const session = await auth();
  if (!session?.user.id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 }),
    };
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "manager") {
    // 404 а не 403 — admin-API не должен подтверждать существование (§5).
    return {
      ok: false,
      response: NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 }),
    };
  }
  return {
    ok: true,
    userId: session.user.id,
    role: role as AdminRole,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
  };
}
