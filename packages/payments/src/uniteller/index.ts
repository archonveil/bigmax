/**
 * Public API пакета `@bigmax/payments/uniteller`.
 *
 * P4-T4 — только формирование платежа:
 *   - URLs и статусы (`constants.ts`)
 *   - Zod-схемы контрактов (`types.ts`)
 *   - buildSignature для POST /pay/ (`signature.ts`)
 *
 * P4-T5/T6/T12 добавят сюда `client.ts`, `webhook.ts` (verifyCallback),
 * `mock-server.ts` (последний уже существует отдельным артефактом для
 * docker-compose, но как модуль — в этот index пока не экспортируется).
 */

export * from "./client";
export * from "./constants";
export * from "./mask";
export * from "./mock-helpers";
export * from "./signature";
export * from "./types";
