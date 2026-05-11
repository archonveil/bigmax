import type { FetchPaymentStatusResult } from "@bigmax/payments/uniteller";
import { describe, expect, it, vi } from "vitest";

import {
  checkPendingPaymentsJob,
  decidePaymentAction,
  type CheckPendingPaymentsDeps,
} from "./check-pending-payments";

const NOW = new Date("2026-04-25T12:00:00.000Z");

function snapshotOk(status: string, extras: Record<string, string> = {}): FetchPaymentStatusResult {
  return {
    kind: "ok",
    items: [
      {
        OrderId: "BGX-20260425-0001",
        Status: status as "Authorized" | "Paid" | "Canceled" | "NotAuthorized" | "Waiting",
        Total: "15000.00",
        ...extras,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// decidePaymentAction
// ---------------------------------------------------------------------------

describe("decidePaymentAction · snapshot mapping (§5.8)", () => {
  const freshPayment = { createdAt: new Date(NOW.getTime() - 5 * 60_000), status: "pending" };

  it("Authorized → capture", () => {
    const action = decidePaymentAction({
      payment: freshPayment,
      snapshot: snapshotOk("Authorized", { Billnumber: "RRN-1", ApprovalCode: "00" }),
      now: NOW,
    });
    expect(action.kind).toBe("capture");
    if (action.kind === "capture") {
      expect(action.billnumber).toBe("RRN-1");
      expect(action.responseCode).toBe("00");
    }
  });

  it("Paid → capture", () => {
    const action = decidePaymentAction({
      payment: freshPayment,
      snapshot: snapshotOk("Paid"),
      now: NOW,
    });
    expect(action.kind).toBe("capture");
  });

  it("Canceled → fail", () => {
    const action = decidePaymentAction({
      payment: freshPayment,
      snapshot: snapshotOk("Canceled"),
      now: NOW,
    });
    expect(action.kind).toBe("fail");
  });

  it("NotAuthorized → fail", () => {
    const action = decidePaymentAction({
      payment: freshPayment,
      snapshot: snapshotOk("NotAuthorized"),
      now: NOW,
    });
    expect(action.kind).toBe("fail");
  });

  it("Waiting → noop (даже если payment свежий)", () => {
    const action = decidePaymentAction({
      payment: freshPayment,
      snapshot: snapshotOk("Waiting"),
      now: NOW,
    });
    expect(action.kind).toBe("noop");
  });
});

describe("decidePaymentAction · lifetime expiry (§5.8)", () => {
  it("Lifetime+grace=35мин истёк, snapshot=null → cancel_local", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 36 * 60_000), status: "pending" },
      snapshot: null,
      now: NOW,
    });
    expect(action.kind).toBe("cancel_local");
    if (action.kind === "cancel_local") expect(action.reason).toBe("lifetime_expired");
  });

  it("Lifetime+grace=35мин истёк, snapshot=Waiting → cancel_local", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 40 * 60_000), status: "pending" },
      snapshot: snapshotOk("Waiting"),
      now: NOW,
    });
    expect(action.kind).toBe("cancel_local");
  });

  it("Authorized после lifetime — всё равно capture (терминальный статус приоритетнее)", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 60 * 60_000), status: "pending" },
      snapshot: snapshotOk("Authorized"),
      now: NOW,
    });
    expect(action.kind).toBe("capture");
  });

  it("ровно 35мин (на границе) → cancel_local", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 35 * 60_000), status: "pending" },
      snapshot: null,
      now: NOW,
    });
    expect(action.kind).toBe("cancel_local");
  });

  it("34:59 → noop (не истёк)", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 34 * 60_000 - 59_000), status: "pending" },
      snapshot: null,
      now: NOW,
    });
    expect(action.kind).toBe("noop");
  });

  it("кастомный lifetimeMin=10 → cancel_local после 15 мин (10+5 grace)", () => {
    const action = decidePaymentAction({
      payment: { createdAt: new Date(NOW.getTime() - 16 * 60_000), status: "pending" },
      snapshot: null,
      now: NOW,
      lifetimeMin: 10,
    });
    expect(action.kind).toBe("cancel_local");
  });
});

describe("decidePaymentAction · отсутствующий/пустой snapshot", () => {
  const fresh = { createdAt: new Date(NOW.getTime() - 5 * 60_000), status: "pending" };

  it("snapshot=null → noop (если ещё не истёк lifetime)", () => {
    expect(decidePaymentAction({ payment: fresh, snapshot: null, now: NOW }).kind).toBe("noop");
  });

  it("snapshot.kind=auth_error → noop (как будто не запросили)", () => {
    const action = decidePaymentAction({
      payment: fresh,
      snapshot: { kind: "auth_error", httpStatus: 401 },
      now: NOW,
    });
    expect(action.kind).toBe("noop");
  });

  it("snapshot.kind=ok с пустым items → noop", () => {
    const action = decidePaymentAction({
      payment: fresh,
      snapshot: { kind: "ok", items: [] },
      now: NOW,
    });
    expect(action.kind).toBe("noop");
  });
});

// ---------------------------------------------------------------------------
// checkPendingPaymentsJob orchestrator (mock prisma + fetchStatus)
// ---------------------------------------------------------------------------

interface MockPayment {
  id: string;
  orderId: string;
  status: string;
  createdAt: Date;
  unitellerOrderIdp: string | null;
}

function buildMocks(payments: MockPayment[]) {
  const updates: Array<{ table: string; data: unknown; where?: unknown }> = [];
  const transactions: unknown[][] = [];

  const prisma = {
    payment: {
      findMany: vi.fn().mockResolvedValue(payments),
      update: vi.fn((args: { where: unknown; data: unknown }) => {
        updates.push({ table: "payment", ...args });
        return Promise.resolve({});
      }),
    },
    order: {
      update: vi.fn((args: { where: unknown; data: unknown }) => {
        updates.push({ table: "order", ...args });
        return Promise.resolve({});
      }),
    },
    paymentLog: {
      create: vi.fn((args: { data: unknown }) => {
        updates.push({ table: "paymentLog", ...args });
        return Promise.resolve({});
      }),
    },
    $transaction: vi.fn((ops: unknown[]) => {
      transactions.push(ops);
      return Promise.resolve(ops);
    }),
  };

  return { prisma, updates, transactions };
}

describe("checkPendingPaymentsJob · orchestrator", () => {
  it("без pending-платежей → JobResult со scanned=0", async () => {
    const { prisma } = buildMocks([]);
    const fetchStatus = vi.fn();
    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });
    expect(result).toEqual({ scanned: 0, captured: 0, failed: 0, cancelled: 0, errors: 0 });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("Authorized snapshot → captured + транзакция Order/Payment/Log", async () => {
    const payment: MockPayment = {
      id: "p1",
      orderId: "o1",
      status: "pending",
      createdAt: new Date(NOW.getTime() - 5 * 60_000),
      unitellerOrderIdp: "BGX-20260425-0001",
    };
    const { prisma, transactions } = buildMocks([payment]);
    const fetchStatus = vi.fn().mockResolvedValue(snapshotOk("Authorized", { Billnumber: "R1" }));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    expect(result.scanned).toBe(1);
    expect(result.captured).toBe(1);
    expect(fetchStatus).toHaveBeenCalledWith("BGX-20260425-0001");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(3); // payment.update + order.update + paymentLog.create
  });

  it("Canceled snapshot → failed (без Order.update)", async () => {
    const payment: MockPayment = {
      id: "p2",
      orderId: "o2",
      status: "pending",
      createdAt: new Date(NOW.getTime() - 5 * 60_000),
      unitellerOrderIdp: "BGX-20260425-0002",
    };
    const { prisma, transactions } = buildMocks([payment]);
    const fetchStatus = vi.fn().mockResolvedValue(snapshotOk("Canceled"));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    expect(result.failed).toBe(1);
    expect(result.captured).toBe(0);
    expect(transactions[0]).toHaveLength(2); // payment.update + paymentLog.create (Order не трогаем)
  });

  it("Waiting snapshot + не истёк lifetime → noop, ничего не пишем", async () => {
    const payment: MockPayment = {
      id: "p3",
      orderId: "o3",
      status: "pending",
      createdAt: new Date(NOW.getTime() - 5 * 60_000),
      unitellerOrderIdp: "BGX-20260425-0003",
    };
    const { prisma, transactions } = buildMocks([payment]);
    const fetchStatus = vi.fn().mockResolvedValue(snapshotOk("Waiting"));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    expect(result).toMatchObject({ scanned: 1, captured: 0, failed: 0, cancelled: 0 });
    expect(transactions).toHaveLength(0);
  });

  it("истёк lifetime + snapshot=Waiting → cancel_local", async () => {
    const payment: MockPayment = {
      id: "p4",
      orderId: "o4",
      status: "pending",
      createdAt: new Date(NOW.getTime() - 40 * 60_000),
      unitellerOrderIdp: "BGX-20260425-0004",
    };
    const { prisma, transactions } = buildMocks([payment]);
    const fetchStatus = vi.fn().mockResolvedValue(snapshotOk("Waiting"));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    expect(result.cancelled).toBe(1);
    expect(transactions[0]).toHaveLength(3); // payment.update + order.update + paymentLog
  });

  it("fetchStatus throws → errors++ + log, decision на основе lifetime", async () => {
    const payment: MockPayment = {
      id: "p5",
      orderId: "o5",
      status: "pending",
      createdAt: new Date(NOW.getTime() - 40 * 60_000),
      unitellerOrderIdp: "BGX-20260425-0005",
    };
    const { prisma } = buildMocks([payment]);
    const fetchStatus = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    // errors=1 за fetch-fail, cancelled=1 за истёкший lifetime.
    expect(result.errors).toBe(1);
    expect(result.cancelled).toBe(1);
  });

  it("несколько payments — обрабатываются независимо", async () => {
    const payments: MockPayment[] = [
      {
        id: "a",
        orderId: "oa",
        status: "pending",
        createdAt: new Date(NOW.getTime() - 5 * 60_000),
        unitellerOrderIdp: "BGX-A",
      },
      {
        id: "b",
        orderId: "ob",
        status: "pending",
        createdAt: new Date(NOW.getTime() - 5 * 60_000),
        unitellerOrderIdp: "BGX-B",
      },
      {
        id: "c",
        orderId: "oc",
        status: "pending",
        createdAt: new Date(NOW.getTime() - 5 * 60_000),
        unitellerOrderIdp: "BGX-C",
      },
    ];
    const { prisma } = buildMocks(payments);
    const fetchStatus = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(snapshotOk("Authorized")))
      .mockImplementationOnce(() => Promise.resolve(snapshotOk("Canceled")))
      .mockImplementationOnce(() => Promise.resolve(snapshotOk("Waiting")));

    const result = await checkPendingPaymentsJob({
      prisma: prisma as unknown as CheckPendingPaymentsDeps["prisma"],
      fetchStatus,
      now: () => NOW,
    });

    expect(result).toMatchObject({ scanned: 3, captured: 1, failed: 1, cancelled: 0 });
  });
});
