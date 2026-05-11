import { describe, expect, it, vi } from "vitest";

import { notificationJob, type NotificationJobPayload } from "./notification";

const PAYLOAD: NotificationJobPayload = {
  type: "order_created",
  recipient: {
    userId: "u1",
    phone: "+998901234567",
    telegramChatId: null,
    email: "user@example.com",
    locale: "ru",
  },
  channels: ["sms", "email"],
  payload: {
    orderNumber: "BGX-20260427-0001",
    totalCents: 25_000_00,
    url: "https://bigmax.uz/ru/orders/abc/success",
  },
};

function buildClients() {
  const eskiz = { sendSms: vi.fn().mockResolvedValue({ id: "sms-1", status: "mock" as const }) };
  const telegram = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 1, status: "mock" as const }),
  };
  const resend = {
    sendEmail: vi.fn().mockResolvedValue({ id: "email-1", status: "mock" as const }),
  };
  const prisma = {
    notification: { create: vi.fn().mockResolvedValue({}) },
  };
  return { eskiz, telegram, resend, prisma } as never;
}

describe("notificationJob", () => {
  it("order_created с 2 каналами → channels=2, ok=2, failed=0", async () => {
    const result = await notificationJob(buildClients(), PAYLOAD);
    expect(result.type).toBe("order_created");
    expect(result.channels).toBe(2);
    expect(result.ok).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("неизвестный type → no-op (channels=0)", async () => {
    const result = await notificationJob(buildClients(), {
      ...PAYLOAD,
      type: "order_status_changed" as never,
    });
    expect(result.channels).toBe(0);
  });

  it("partial failure → failed > 0 (но job не throw'ит)", async () => {
    const clients = buildClients();
    (
      clients as { eskiz: { sendSms: ReturnType<typeof vi.fn> } }
    ).eskiz.sendSms.mockRejectedValueOnce(new Error("boom"));
    const result = await notificationJob(clients, PAYLOAD);
    expect(result.failed).toBe(1);
    expect(result.ok).toBe(1);
  });
});
