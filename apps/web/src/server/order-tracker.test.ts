/**
 * P5-T3: чистый маппер `Order.status → OrderTrackerView`.
 */

import { describe, expect, it } from "vitest";

import { computeOrderTrackerView, TRACKER_STEPS } from "./order-tracker";

describe("computeOrderTrackerView · stepper happy-path", () => {
  it("pending → все 4 шага upcoming + pendingPreflight=true", () => {
    const view = computeOrderTrackerView("pending");
    expect(view).toEqual({
      kind: "stepper",
      pendingPreflight: true,
      steps: [
        { key: "confirmed", state: "upcoming" },
        { key: "packing", state: "upcoming" },
        { key: "shipped", state: "upcoming" },
        { key: "delivered", state: "upcoming" },
      ],
    });
  });

  it("confirmed → confirmed=current, остальные upcoming", () => {
    const view = computeOrderTrackerView("confirmed");
    expect(view).toEqual({
      kind: "stepper",
      pendingPreflight: false,
      steps: [
        { key: "confirmed", state: "current" },
        { key: "packing", state: "upcoming" },
        { key: "shipped", state: "upcoming" },
        { key: "delivered", state: "upcoming" },
      ],
    });
  });

  it("packing → confirmed=done, packing=current", () => {
    const view = computeOrderTrackerView("packing");
    if (view.kind !== "stepper") throw new Error("expected stepper");
    expect(view.steps.map((s) => s.state)).toEqual(["done", "current", "upcoming", "upcoming"]);
  });

  it("shipped → confirmed/packing=done, shipped=current", () => {
    const view = computeOrderTrackerView("shipped");
    if (view.kind !== "stepper") throw new Error("expected stepper");
    expect(view.steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
  });

  it("delivered → все done (без current)", () => {
    const view = computeOrderTrackerView("delivered");
    if (view.kind !== "stepper") throw new Error("expected stepper");
    expect(view.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(view.pendingPreflight).toBe(false);
  });
});

describe("computeOrderTrackerView · terminal", () => {
  it("cancelled → terminal block", () => {
    expect(computeOrderTrackerView("cancelled")).toEqual({
      kind: "terminal",
      terminal: "cancelled",
    });
  });

  it("refunded → terminal block", () => {
    expect(computeOrderTrackerView("refunded")).toEqual({
      kind: "terminal",
      terminal: "refunded",
    });
  });
});

describe("computeOrderTrackerView · инварианты", () => {
  it("stepper всегда содержит ровно 4 шага в фиксированном порядке", () => {
    for (const status of ["pending", "confirmed", "packing", "shipped", "delivered"] as const) {
      const view = computeOrderTrackerView(status);
      if (view.kind !== "stepper") throw new Error(`${status} expected stepper`);
      expect(view.steps).toHaveLength(4);
      expect(view.steps.map((s) => s.key)).toEqual(TRACKER_STEPS);
    }
  });

  it("в stepper максимум один current", () => {
    for (const status of ["pending", "confirmed", "packing", "shipped", "delivered"] as const) {
      const view = computeOrderTrackerView(status);
      if (view.kind !== "stepper") continue;
      const currentCount = view.steps.filter((s) => s.state === "current").length;
      expect(currentCount).toBeLessThanOrEqual(1);
    }
  });

  it("upcoming идут только после current/done — нет «дыр»", () => {
    for (const status of ["pending", "confirmed", "packing", "shipped", "delivered"] as const) {
      const view = computeOrderTrackerView(status);
      if (view.kind !== "stepper") continue;
      let seenUpcoming = false;
      for (const step of view.steps) {
        if (step.state === "upcoming") seenUpcoming = true;
        else if (seenUpcoming) {
          throw new Error(
            `${status}: ${step.key} (${step.state}) после upcoming — нарушение порядка`,
          );
        }
      }
    }
  });
});
