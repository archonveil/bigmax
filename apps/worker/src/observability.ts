/**
 * Sentry-hook для worker'а (P4-T9 sub-task E + раннее завершение P4-T11).
 *
 * Поведение:
 *   - **Без `SENTRY_DSN`**: `console.error` с тегом `[error]`. Полезно для
 *     dev/тестов и low-volume self-hosted окружений.
 *   - **С `SENTRY_DSN`**: `Sentry.init({dsn, ...})` единожды (lazy init на
 *     первом вызове `reportError`); каждая ошибка идёт в Sentry через
 *     `captureException` с `scope` как тэг и `extra` как additional data.
 *     Параллельно дублируется `console.error` с тегом `[sentry]` —
 *     sysadmin видит и в логах, и в Sentry UI.
 *
 * **Безопасность (§5.12)**: ничего из `extra` не должно содержать PAN,
 * `UNITELLER_PASSWORD`, callback-payload и тд. Caller'ы передают только
 * id'шники и summaries (paymentId, decision-name, scope). PaymentLog-таблица
 * с детальным request/response — отдельный канал (P4-T11 запишет туда полные
 * payload'ы с маскированием карт по последним 4 цифрам).
 *
 * Никогда не throw'ит — observability не должна валить рабочий код.
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
      // Worker — backend-процесс, без user-impact метрик. Tracing выключаем
      // до P8-T3 (тогда поднимем sampling и подключим OTel-связку).
      tracesSampleRate: 0,
      // Имя сервиса для группировки в Sentry-UI (`service:bigmax-worker`).
      serverName: "bigmax-worker",
      environment: process.env["NODE_ENV"] ?? "development",
    });
    initialized = "yes";
    return true;
  } catch {
    // Если @sentry/node по какой-то причине упал на init — fallback на
    // console-only режим, не валим worker.
    initialized = "skipped";
    return false;
  }
}

export interface ErrorContext {
  /** Логический «source» (e.g. `worker.checkPendingPayments`). */
  scope: string;
  /** Произвольные id'шники и summaries — НЕ полные payload'ы. */
  extra?: Record<string, unknown>;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  const sentryReady = ensureInit();
  const tag = sentryReady ? "[sentry]" : "[error]";
  const message = err instanceof Error ? err.message : String(err);

  // 1. Локальное логирование — всегда. Под docker-compose `docker logs` /
  //    в проде stdout агрегируется CloudWatch'ем или k8s-логом.
  try {
    console.error(`${tag} scope=${ctx.scope} message=${JSON.stringify(message)}`, ctx.extra ?? {});
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  } catch {
    // best-effort; никогда не throw'им из observability.
  }

  // 2. Sentry — только если init прошёл./
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
