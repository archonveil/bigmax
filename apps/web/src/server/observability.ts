/**
 * Sentry-hook для web (P4-T11). Зеркало `apps/worker/src/observability.ts`,
 * выделено в свой модуль т.к. apps не делятся `src/server` файлами.
 *
 * Поведение:
 *   - **Без `SENTRY_DSN`**: `console.error` с тегом `[error]`. Полезно для
 *     dev/тестов и low-volume self-hosted окружений.
 *   - **С `SENTRY_DSN`**: `Sentry.init({dsn, ...})` единожды (lazy на первом
 *     `reportError`), `serverName: "bigmax-web"`, `tracesSampleRate: 0`
 *     (поднимем в P8-T3). Каждая ошибка → `captureException` с `scope` как
 *     tag и `extra` как additional data.
 *
 * **Безопасность (§5.12)**: caller'ы передают только id'шники и summaries.
 * Полные payload'ы из Uniteller-callback'а / pay-route'а идут через
 * `writePaymentLog` → `scrubPaymentPayload` (PAN-маскирование + redact
 * секретов). Sentry-контекст — **только** scope-name, paymentId и status code.
 *
 * Никогда не throw'ит — observability не должна валить web-route.
 */

import * as Sentry from "@sentry/node";

let initialized: "no" | "yes" | "skipped" = "no";

function ensureInit(): boolean {
  if (initialized !== "no") return initialized === "yes";
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn || dsn.trim() === "") {
    initialized = "skipped";
    return false;
  }
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      serverName: "bigmax-web",
      environment: process.env["NODE_ENV"] ?? "development",
    });
    initialized = "yes";
    return true;
  } catch {
    initialized = "skipped";
    return false;
  }
}

export interface ErrorContext {
  /** Логический «source» (e.g. `web.webhook.uniteller`). */
  scope: string;
  /** Произвольные id'шники и summaries — НЕ полные payload'ы. */
  extra?: Record<string, unknown>;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  const sentryReady = ensureInit();
  const tag = sentryReady ? "[sentry]" : "[error]";
  const message = err instanceof Error ? err.message : String(err);

  try {
    console.error(`${tag} scope=${ctx.scope} message=${JSON.stringify(message)}`, ctx.extra ?? {});
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  } catch {
    // best-effort; никогда не throw'им из observability.
  }

  if (!sentryReady) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("scope", ctx.scope);
      if (ctx.extra) {
        for (const [k, v] of Object.entries(ctx.extra)) {
          scope.setExtra(k, v);
        }
      }
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message, "error");
      }
    });
  } catch {
    // best-effort.
  }
}

/** Для тестов: сброс флага инициализации (чтобы env-mock'и сработали заново). */
export function _resetSentryForTests(): void {
  initialized = "no";
}
