/**
 * P6-T8 follow-up (closes (b)): self-service password reset через email.
 *
 * **Threat model**:
 *  - Email enumeration: эндпоинт `request` возвращает одинаковый response
 *    для known/unknown emails (защита от user-discovery'а).
 *  - Brute-force на token: 32-byte cryptographic random → ~256 bits entropy,
 *    rate-limit на `complete` через email + IP (защита от guessing).
 *  - Replay: `usedAt` ставится после complete → один token = один reset.
 *  - Token leakage в logs: храним только bcrypt-hash в `tokenHash`; plain
 *    есть только в email-link и в response одного `request`-call'а.
 *  - TTL: 30 минут — баланс между UX и attack-window.
 *
 * **Token format**: `${tokenId}.${plainToken}`. UI получает url
 * `/auth/password-reset/${tokenId}.${plain}` и при complete'е extracts
 * `tokenId` для O(1)-lookup'а в БД, `plain` — для bcrypt-compare'а.
 */

import { randomBytes } from "node:crypto";

import { prisma } from "@bigmax/db";
import { compare, hash } from "bcryptjs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PASSWORD_RESET_TTL_MIN = 30;
const TOKEN_BYTES = 32; // → 64 hex chars

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const PasswordResetRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("invalid_email").max(200),
  })
  .strict();

export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;

/**
 * Token format: `${tokenId}.${plain}` где tokenId — cuid из БД, plain —
 * 64-char hex. Regex минимальная — hard validation проходит на DB lookup.
 */
const COMPOUND_TOKEN_RE = /^[a-z0-9]+\.[a-f0-9]+$/i;

export const PasswordResetCompleteSchema = z
  .object({
    token: z.string().regex(COMPOUND_TOKEN_RE, "invalid_token").max(200),
    /** Минимум 8 символов — стандарт для consumer-flow'а; admin-driven
     *  reset через generateTempPassword выдаёт 12 chars. */
    password: z.string().min(8, "password_too_short").max(200, "password_too_long"),
  })
  .strict();

export type PasswordResetCompleteInput = z.infer<typeof PasswordResetCompleteSchema>;

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

/**
 * Генерирует cryptographic random token. Возвращает plain (для email)
 * + bcrypt-hash (для БД). cost-factor 10 — стандарт NextAuth для passwords;
 * для tokens достаточно (256 bits entropy → brute-force нерелевантен).
 */
export async function generateResetToken(): Promise<{
  plain: string;
  hash: string;
}> {
  const plain = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = await hash(plain, 10);
  return { plain, hash: tokenHash };
}

/**
 * Парсит compound-token `${tokenId}.${plain}` → разделяет на части. null
 * для невалидного формата.
 */
export function parseCompoundToken(input: string): { tokenId: string; plain: string } | null {
  const idx = input.indexOf(".");
  if (idx <= 0 || idx === input.length - 1) return null;
  return { tokenId: input.slice(0, idx), plain: input.slice(idx + 1) };
}

/**
 * Verifies plain-token против stored hash. Wrapper над bcrypt.compare для
 * type-safety + единое место для логики.
 */
export async function verifyResetToken(plain: string, tokenHash: string): Promise<boolean> {
  return compare(plain, tokenHash);
}

/**
 * Computes expiresAt = now + TTL. Pure для тестируемости.
 */
export function computeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MIN * 60_000);
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/**
 * Создаёт reset-token для user.id. Возвращает compound `tokenId.plain`
 * для embed'инга в email-link. Cleanup: invalidate'ит все previous-tokens
 * этого user'а (помечает usedAt=now), чтобы старые links перестали работать.
 */
export async function createResetToken(userId: string): Promise<string> {
  const { plain, hash: tokenHash } = await generateResetToken();
  const expiresAt = computeExpiresAt();

  // Invalidate всех предыдущих non-used tokens — security best practice:
  // если юзер запрашивал reset 3 раза, первые два должны перестать работать.
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const created = await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
    select: { id: true },
  });

  return `${created.id}.${plain}`;
}

export type ResetTokenLookupResult =
  | { kind: "ok"; userId: string; tokenId: string }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_used" }
  | { kind: "invalid_format" };

/**
 * Находит и валидирует token. Не throw'ит. Caller отвечает за
 * mark-as-used (это делается в transaction'е вместе с password-update'ом).
 */
export async function lookupResetToken(compound: string): Promise<ResetTokenLookupResult> {
  const parts = parseCompoundToken(compound);
  if (!parts) return { kind: "invalid_format" };
  const row = await prisma.passwordResetToken.findUnique({
    where: { id: parts.tokenId },
    select: { id: true, userId: true, tokenHash: true, expiresAt: true, usedAt: true },
  });
  if (!row) return { kind: "not_found" };
  if (row.usedAt !== null) return { kind: "already_used" };
  if (row.expiresAt.getTime() < Date.now()) return { kind: "expired" };
  const ok = await verifyResetToken(parts.plain, row.tokenHash);
  if (!ok) return { kind: "not_found" };
  return { kind: "ok", userId: row.userId, tokenId: row.id };
}
