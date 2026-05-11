import * as Sentry from "@sentry/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSentryForTests, reportError } from "./observability";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  withScope: vi.fn((cb: (scope: { setTag: () => void; setExtra: () => void }) => void) =>
    cb({ setTag: vi.fn(), setExtra: vi.fn() }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe("reportError", () => {
  const originalDsn = process.env["SENTRY_DSN"];

  beforeEach(() => {
    _resetSentryForTests();
    vi.mocked(Sentry.init).mockClear();
    vi.mocked(Sentry.withScope).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.captureMessage).mockClear();
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env["SENTRY_DSN"];
    else process.env["SENTRY_DSN"] = originalDsn;
    vi.restoreAllMocks();
  });

  it("без SENTRY_DSN → console.error с тегом [error], Sentry.init НЕ вызывается", () => {
    delete process.env["SENTRY_DSN"];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"), { scope: "test.scope" });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]![0]).toMatch(/^\[error\] scope=test\.scope/);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("с SENTRY_DSN → тег [sentry] + lazy Sentry.init на первом вызове", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"), { scope: "test.scope" });
    expect(spy.mock.calls[0]![0]).toMatch(/^\[sentry\] scope=test\.scope/);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://example.ingest.sentry.io/123",
        tracesSampleRate: 0,
        serverName: "bigmax-worker",
      }),
    );
  });

  it("второй вызов с DSN не реинициализирует Sentry (init только один раз)", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("first"), { scope: "s" });
    reportError(new Error("second"), { scope: "s" });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("Error → captureException с этим же объектом", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("network");
    reportError(err, { scope: "worker.x" });
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("non-Error → captureMessage(string, 'error')", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("plain string error", { scope: "s" });
    expect(Sentry.captureMessage).toHaveBeenCalledWith("plain string error", "error");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("scope/extra ставятся через withScope.setTag/setExtra", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setTag = vi.fn();
    const setExtra = vi.fn();
    (Sentry.withScope as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (s: unknown) => unknown) => cb({ setTag, setExtra }),
    );
    reportError(new Error("x"), { scope: "worker.test", extra: { paymentId: "p1", n: 42 } });
    expect(setTag).toHaveBeenCalledWith("scope", "worker.test");
    expect(setExtra).toHaveBeenCalledWith("paymentId", "p1");
    expect(setExtra).toHaveBeenCalledWith("n", 42);
  });

  it("Sentry.init throws → graceful fallback на console-only", () => {
    process.env["SENTRY_DSN"] = "https://example.ingest.sentry.io/123";
    vi.mocked(Sentry.init).mockImplementationOnce(() => {
      throw new Error("init failed");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reportError(new Error("x"), { scope: "s" })).not.toThrow();
    // После fallback тег [error] (как без DSN).
    expect(spy.mock.calls[0]![0]).toMatch(/^\[error\] scope=s/);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("без SENTRY_DSN: extra-метаданные передаются в console.error вторым аргументом", () => {
    delete process.env["SENTRY_DSN"];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("x"), { scope: "s", extra: { paymentId: "p1" } });
    expect(spy.mock.calls[0]![1]).toEqual({ paymentId: "p1" });
  });

  it("никогда не throw'ит даже если console.error падает", () => {
    delete process.env["SENTRY_DSN"];
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console broken");
    });
    expect(() => reportError(new Error("x"), { scope: "s" })).not.toThrow();
  });
});
