/**
 * `<OrderTracker>` (P5-T3) — горизонтальный 4-шаговый stepper статуса
 * заказа, либо terminal-блок для cancelled/refunded.
 *
 * Pure server component: тип view'а вычисляет `computeOrderTrackerView`
 * (`@/server/order-tracker.ts`), здесь только рендер. Без timestamps на
 * каждом шаге — `Order` хранит только `createdAt`/`updatedAt`, история
 * переходов появится в P6-T5 с админкой.
 */

import type { OrderStatus } from "@bigmax/db";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  computeOrderTrackerView,
  type TrackerStepKey,
  type TrackerStepState,
} from "@/server/order-tracker";

/**
 * Tone-mapping для кружков step'ов. Done/current — primary-цвета;
 * upcoming — приглушённый.
 */
const STEP_TONE: Record<TrackerStepState, string> = {
  done: "border-emerald-500 bg-emerald-500 text-white",
  current: "border-blue-500 bg-blue-500 text-white animate-pulse",
  upcoming: "border-muted bg-background text-muted-foreground",
};

const CONNECTOR_TONE: Record<TrackerStepState, string> = {
  done: "bg-emerald-500",
  current: "bg-blue-500",
  upcoming: "bg-muted",
};

export function OrderTracker({ status }: { status: OrderStatus }): JSX.Element {
  const t = useTranslations("account.orders.detail.tracker");
  const tStep = useTranslations("account.orders.statuses");
  const view = computeOrderTrackerView(status);

  if (view.kind === "terminal") {
    const Icon = view.terminal === "cancelled" ? AlertTriangle : RotateCcw;
    const tone =
      view.terminal === "cancelled"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-slate-50 text-slate-900";
    return (
      <section
        className={`rounded-lg border ${tone} p-4`}
        data-testid="order-tracker"
        data-tracker-kind={view.kind}
        data-tracker-terminal={view.terminal}
      >
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">{t(`terminal.${view.terminal}.title`)}</p>
            <p className="text-sm">{t(`terminal.${view.terminal}.body`)}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border bg-card p-4"
      data-testid="order-tracker"
      data-tracker-kind={view.kind}
      data-tracker-pending={view.pendingPreflight ? "true" : "false"}
    >
      <h2 className="mb-3 text-base font-semibold">{t("title")}</h2>
      <ol className="flex items-start gap-2">
        {view.steps.map((step, i) => (
          <li
            key={step.key}
            className="flex flex-1 flex-col items-center text-center"
            data-step={step.key}
            data-step-state={step.state}
          >
            <div className="flex w-full items-center">
              {/* Левый коннектор — кроме первого шага. */}
              {i > 0 ? (
                <div
                  className={`h-0.5 flex-1 ${CONNECTOR_TONE[step.state === "current" ? "done" : step.state]}`}
                  aria-hidden
                />
              ) : (
                <div className="flex-1" aria-hidden />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${STEP_TONE[step.state]}`}
              >
                {step.state === "done" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              {/* Правый коннектор — кроме последнего шага. */}
              {i < view.steps.length - 1 ? (
                <div
                  className={`h-0.5 flex-1 ${CONNECTOR_TONE[step.state === "current" ? "upcoming" : step.state]}`}
                  aria-hidden
                />
              ) : (
                <div className="flex-1" aria-hidden />
              )}
            </div>
            <span
              className={`mt-2 block text-xs ${
                step.state === "upcoming" ? "text-muted-foreground" : "font-medium"
              }`}
            >
              {tStep(stepStatusKey(step.key))}
            </span>
          </li>
        ))}
      </ol>
      {view.pendingPreflight ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">{t("pendingCaption")}</p>
      ) : null}
    </section>
  );
}

/**
 * Маппит `TrackerStepKey` к ключам `account.orders.statuses.*` — у нас они
 * совпадают, но изоляция через функцию защищает от drift'а если в будущем
 * добавим новый шаг (например, `awaiting_pickup`).
 */
function stepStatusKey(key: TrackerStepKey): "confirmed" | "packing" | "shipped" | "delivered" {
  return key;
}
