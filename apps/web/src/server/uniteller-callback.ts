/**
 * Обработка callback'ов Uniteller (`/api/webhooks/uniteller`, P4-T6 master-prompt).
 *
 *   1. `parseCallbackBody(text)` — `application/x-www-form-urlencoded` → объект.
 *   2. `evaluateCallback(payload)` — pure decision-функция: валидация Zod +
 *      verifyCallbackSignature → discriminated union с действием.
 *   3. `applyCallback(decision, deps)` — side-effects (Prisma transaction):
 *      создаёт WebhookEvent, обновляет Payment + Order, ставит processed=true.
 *
 * Разделение нужно чтобы (a) тестировать decision-логику без БД, (b) HTTP-
 * route в `route.ts` остался тонким.
 */

import { uniteller } from "@bigmax/payments";
import {
  UnitellerCallbackPayloadSchema,
  type UnitellerCallbackPayload,
} from "@bigmax/payments/uniteller";

/**
 * Парсит `application/x-www-form-urlencoded`-тело Uniteller callback'а в
 * плоский объект. URL-decoded, `+` → пробел, дубль-ключи теряются (Uniteller
 * не дублирует поля — нам это не нужно).
 */
export function parseCallbackBody(text: string): Record<string, string> {
  const params = new URLSearchParams(text);
  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export type CallbackDecision =
  | { kind: "invalid_payload"; issues: string[] }
  | { kind: "invalid_signature"; payload: UnitellerCallbackPayload }
  | { kind: "valid"; payload: UnitellerCallbackPayload };

export interface EvaluateCallbackInput {
  /** Сырой объект из `parseCallbackBody`. */
  raw: Record<string, string>;
  /** `UNITELLER_PASSWORD` из process.env. */
  password: string;
}

/**
 * Pure-функция: парсит, валидирует Zod и подпись.
 *
 * Не лезет в БД и не работает с временем — поэтому полностью покрывается
 * unit-тестами. HTTP-route её вызывает и решает что отвечать.
 */
export function evaluateCallback({ raw, password }: EvaluateCallbackInput): CallbackDecision {
  const parsed = UnitellerCallbackPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "invalid_payload",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const payload = parsed.data;
  const ok = uniteller.verifyCallbackSignature({
    orderId: payload.Order_ID,
    status: payload.Status,
    signature: payload.Signature,
    password,
  });

  if (!ok) return { kind: "invalid_signature", payload };
  return { kind: "valid", payload };
}
