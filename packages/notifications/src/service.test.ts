import type { Locale } from "@bigmax/shared-types";
import { describe, expect, it, vi } from "vitest";

import type { EskizClient } from "./eskiz/types";
import type { ResendClient } from "./resend/types";
import {
  sendOrderCreated,
  type NotificationRecipient,
  type NotificationServiceClients,
} from "./service";
import type { TelegramClient } from "./telegram/types";

const RECIPIENT_FULL: NotificationRecipient = {
  userId: "u1",
  phone: "+998901234567",
  telegramChatId: 123456789,
  email: "user@example.com",
  locale: "ru" as Locale,
};

const PAYLOAD = {
  orderNumber: "BGX-20260427-0001",
  totalCents: 25_000_00,
  url: "https://bigmax.uz/ru/orders/abc/success",
};

function buildMockClients(overrides: Partial<NotificationServiceClients> = {}) {
  const eskiz: EskizClient = {
    sendSms: vi.fn().mockResolvedValue({ id: "sms-1", status: "mock" }),
  };
  const telegram: TelegramClient = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 42, status: "mock" }),
  };
  const resend: ResendClient = {
    sendEmail: vi.fn().mockResolvedValue({ id: "email-1", status: "mock" }),
  };
  const prismaCalls: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    notification: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        prismaCalls.push(args);
        return Promise.resolve({});
      }),
    },
  } as unknown as NotificationServiceClients["prisma"];
  return { eskiz, telegram, resend, prisma, prismaCalls, ...overrides };
}

describe("sendOrderCreated · happy paths", () => {
  it("3 канала (sms+telegram+email) → все ok + 3 Notification rows", async () => {
    const clients = buildMockClients();
    const results = await sendOrderCreated(clients, {
      recipient: RECIPIENT_FULL,
      channels: ["sms", "telegram", "email"],
      payload: PAYLOAD,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(clients.eskiz.sendSms).toHaveBeenCalledOnce();
    expect(clients.telegram.sendMessage).toHaveBeenCalledOnce();
    expect(clients.resend.sendEmail).toHaveBeenCalledOnce();
    expect(clients.prismaCalls).toHaveLength(3);

    // sentAt должен быть проставлен у успешных записей.
    for (const call of clients.prismaCalls) {
      expect(call.data["sentAt"]).toBeInstanceOf(Date);
    }
  });

  it("SMS-канал получает корректный phone", async () => {
    const clients = buildMockClients();
    await sendOrderCreated(clients, {
      recipient: RECIPIENT_FULL,
      channels: ["sms"],
      payload: PAYLOAD,
    });
    expect(clients.eskiz.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+998901234567" }),
    );
  });

  it("Telegram-канал получает chatId числом", async () => {
    const clients = buildMockClients();
    await sendOrderCreated(clients, {
      recipient: RECIPIENT_FULL,
      channels: ["telegram"],
      payload: PAYLOAD,
    });
    expect(clients.telegram.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 123456789 }),
    );
  });

  it("Email — to/subject/html заполнены", async () => {
    const clients = buildMockClients();
    await sendOrderCreated(clients, {
      recipient: RECIPIENT_FULL,
      channels: ["email"],
      payload: PAYLOAD,
    });
    const call = (clients.resend.sendEmail as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as { to: string; subject: string; html: string };
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toContain("BGX-20260427-0001");
    expect(call.html).toContain(PAYLOAD.url);
  });
});

describe("sendOrderCreated · skip без destination", () => {
  it("phone=null + channel=sms → ok:false reason:no_destination, Notification row с skipped=true", async () => {
    const clients = buildMockClients();
    const results = await sendOrderCreated(clients, {
      recipient: { ...RECIPIENT_FULL, phone: null },
      channels: ["sms"],
      payload: PAYLOAD,
    });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toBe("no_destination");
    expect(clients.eskiz.sendSms).not.toHaveBeenCalled();
    expect(clients.prismaCalls).toHaveLength(1);
    const data = clients.prismaCalls[0]!.data;
    expect((data["payload"] as { skipped?: boolean }).skipped).toBe(true);
    expect(data["sentAt"]).toBeNull();
  });

  it("telegramChatId=null → telegram skip", async () => {
    const clients = buildMockClients();
    const results = await sendOrderCreated(clients, {
      recipient: { ...RECIPIENT_FULL, telegramChatId: null },
      channels: ["telegram"],
      payload: PAYLOAD,
    });
    expect(results[0]!.ok).toBe(false);
    expect(clients.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("email=null → email skip; sms+telegram продолжают работать", async () => {
    const clients = buildMockClients();
    const results = await sendOrderCreated(clients, {
      recipient: { ...RECIPIENT_FULL, email: null },
      channels: ["sms", "telegram", "email"],
      payload: PAYLOAD,
    });
    expect(results.find((r) => r.channel === "email")!.ok).toBe(false);
    expect(results.find((r) => r.channel === "sms")!.ok).toBe(true);
    expect(results.find((r) => r.channel === "telegram")!.ok).toBe(true);
  });
});

describe("sendOrderCreated · isolation (один канал упал — другие работают)", () => {
  it("Eskiz throws → SMS error, Telegram+Email всё равно отправляются", async () => {
    const clients = buildMockClients({
      eskiz: { sendSms: vi.fn().mockRejectedValue(new Error("eskiz network down")) },
    });
    const results = await sendOrderCreated(clients, {
      recipient: RECIPIENT_FULL,
      channels: ["sms", "telegram", "email"],
      payload: PAYLOAD,
    });
    expect(results.find((r) => r.channel === "sms")!.ok).toBe(false);
    expect(results.find((r) => r.channel === "sms")!.error).toBe("eskiz network down");
    expect(results.find((r) => r.channel === "telegram")!.ok).toBe(true);
    expect(results.find((r) => r.channel === "email")!.ok).toBe(true);

    // Notification row для упавшего SMS — sentAt=null + payload.error.
    const smsRow = clients.prismaCalls.find(
      (c) => (c.data as { channel: string }).channel === "sms",
    )!;
    expect(smsRow.data["sentAt"]).toBeNull();
    expect((smsRow.data["payload"] as { error?: string }).error).toBe("eskiz network down");
  });
});
