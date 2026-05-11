/**
 * Pure-helper для трекера статуса заказа (P5-T3 master-prompt §8).
 *
 * Маппит `Order.status` (Prisma enum) в один из трёх view-режимов:
 *   - `kind: "stepper"` — happy-path линия Confirmed → Packing → Shipped → Delivered.
 *     `pending` тоже сюда попадает (все шаги `upcoming`, currentIndex=-1).
 *   - `kind: "terminal"` — `cancelled` или `refunded` рендерятся как
 *     самостоятельный блок (не stepper), потому что прерывают воронку.
 *
 * История переходов между статусами (`OrderStatusHistory` таблица) появится
 * в P6-T5 когда admin-панель будет менять `Order.status` руками — там
 * будут timestamps, которые мы повесим на done-шаги. Пока показываем только
 * визуальный progress без timestamps.
 */

import type { OrderStatus } from "@bigmax/db";

/**
 * 4 «активных» шага доставки. `pending` Order.status не попадает в шаги —
 * он рендерится как pre-flight состояние (все шаги `upcoming`).
 */
export const TRACKER_STEPS = ["confirmed", "packing", "shipped", "delivered"] as const;
export type TrackerStepKey = (typeof TRACKER_STEPS)[number];

export type TrackerStepState = "upcoming" | "current" | "done";

export interface TrackerStep {
  key: TrackerStepKey;
  state: TrackerStepState;
}

export type OrderTrackerView =
  | {
      kind: "stepper";
      steps: TrackerStep[];
      /**
       * `true` если Order.status === "pending" — UI добавляет caption «ждём
       * подтверждения». Stepper при этом показывает все шаги как upcoming.
       */
      pendingPreflight: boolean;
    }
  | {
      kind: "terminal";
      terminal: "cancelled" | "refunded";
    };

/**
 * Главный маппер: какой view рендерить под конкретный `Order.status`.
 */
export function computeOrderTrackerView(status: OrderStatus): OrderTrackerView {
  if (status === "cancelled" || status === "refunded") {
    return { kind: "terminal", terminal: status };
  }

  if (status === "pending") {
    return {
      kind: "stepper",
      pendingPreflight: true,
      steps: TRACKER_STEPS.map((key) => ({ key, state: "upcoming" })),
    };
  }

  // confirmed/packing/shipped/delivered: индекс в массиве шагов = current
  // (или последний done если delivered).
  const idx = (TRACKER_STEPS as readonly string[]).indexOf(status);
  const steps: TrackerStep[] = TRACKER_STEPS.map((key, i) => ({
    key,
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));

  // delivered — всё done, нет current. Меняем последний `current` на `done`.
  if (status === "delivered") {
    steps[steps.length - 1] = { key: "delivered", state: "done" };
  }

  return { kind: "stepper", pendingPreflight: false, steps };
}
