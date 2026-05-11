/**
 * Диспетчер уведомлений (P4-T10). Принимает event + payload, рендерит
 * шаблоны через `@bigmax/i18n`, отправляет в выбранные каналы и пишет
 * `Notification`-row в БД с `sentAt`.
 *
 * Вызывается из BullMQ-worker'а (`apps/worker/src/jobs/notification.ts`)
 * — здесь pure async, без BullMQ-зависимостей. DI на клиентах позволяет
 * подменять mock'и в тестах.
 *
 * **События**:
 *   - `order_created` — реализовано в P4-T10 (триггеры: webhook captured,
 *     COD-route success).
 *   - `order_status_changed`, `order_delivered` — пока не реализованы, ключи
 *     i18n не подняты; добавится в P6-T5/T6 (admin-flow).
 */

// P7-T1 sub-tasks collateral: `@bigmax/db.prisma` — это `ExtendedPrismaClient`
// с `$extends.result` (BigInt → number coercion). Raw `PrismaClient` имеет
// `$on`/`$use`, которых нет у extended — поэтому passing extended-instance
// в parameter `PrismaClient` фейлил typecheck. Везде, где принимаем live
// prisma-instance из app кода — типизируемся через `ExtendedPrismaClient`.
import type { ExtendedPrismaClient } from "@bigmax/db";
import type { Locale } from "@bigmax/shared-types";

import type { EskizClient } from "./eskiz/types";
import type { ResendClient } from "./resend/types";
import type { TelegramClient } from "./telegram/types";
import {
  buildOrderCreatedEmail,
  buildOrderCreatedSms,
  buildOrderCreatedTelegram,
  type OrderCreatedPayload,
} from "./templates/order/created";

export type NotificationChannel = "sms" | "telegram" | "email";
export type NotificationType = "order_created" | "order_status_changed" | "order_delivered";

export interface NotificationRecipient {
  /** ID пользователя для записи в `Notification.userId`. `null` для админ-уведомлений. */
  userId: string | null;
  /** E.164 для SMS; `null` если канал не sms или у юзера нет phone. */
  phone: string | null;
  /** chat_id Telegram (числовой или `@channel`); `null` если линковки нет. */
  telegramChatId: string | number | null;
  /** Email; `null` если у юзера нет. */
  email: string | null;
  /** Локаль для рендера шаблонов (`User.language`). */
  locale: Locale;
}

export interface NotificationServiceClients {
  prisma: ExtendedPrismaClient;
  eskiz: EskizClient;
  telegram: TelegramClient;
  resend: ResendClient;
}

export interface SendOrderCreatedInput {
  recipient: NotificationRecipient;
  /** Каналы доставки. Каждый — независимая отправка + отдельная Notification-row. */
  channels: NotificationChannel[];
  payload: OrderCreatedPayload;
}

export interface ChannelResult {
  channel: NotificationChannel;
  ok: boolean;
  /** Provider id (Eskiz id / Telegram message_id / Resend id). */
  externalId?: string;
  error?: string;
}

/**
 * Отправляет `order_created` уведомление по выбранным каналам. Каждый канал
 * обрабатывается независимо: ошибка одного не блокирует другие.
 *
 * Если у получателя нет phone/email/chatId для запрошенного канала — канал
 * **пропускается** (без error) с пометкой в `Notification.payload.skipped=true`.
 */
export async function sendOrderCreated(
  clients: NotificationServiceClients,
  input: SendOrderCreatedInput,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  for (const channel of input.channels) {
    results.push(await sendSingleChannel(clients, "order_created", input, channel));
  }
  return results;
}

async function sendSingleChannel(
  clients: NotificationServiceClients,
  type: NotificationType,
  input: SendOrderCreatedInput,
  channel: NotificationChannel,
): Promise<ChannelResult> {
  const { recipient, payload } = input;

  // Проверка: есть ли куда отправлять? Без destination — записываем skipped.
  const destination = pickDestination(recipient, channel);
  if (destination === null) {
    await writeNotificationRow(clients.prisma, {
      type,
      channel,
      userId: recipient.userId,
      locale: recipient.locale,
      payload: { ...payload, skipped: true, reason: "no_destination" },
      sent: false,
    });
    return { channel, ok: false, error: "no_destination" };
  }

  try {
    const externalId = await dispatchToChannel(
      clients,
      channel,
      destination,
      recipient.locale,
      payload,
    );
    await writeNotificationRow(clients.prisma, {
      type,
      channel,
      userId: recipient.userId,
      locale: recipient.locale,
      payload: { ...payload, externalId },
      sent: true,
    });
    return { channel, ok: true, externalId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await writeNotificationRow(clients.prisma, {
      type,
      channel,
      userId: recipient.userId,
      locale: recipient.locale,
      payload: { ...payload, error: message },
      sent: false,
    });
    return { channel, ok: false, error: message };
  }
}

function pickDestination(
  recipient: NotificationRecipient,
  channel: NotificationChannel,
): string | number | null {
  switch (channel) {
    case "sms":
      return recipient.phone;
    case "telegram":
      return recipient.telegramChatId;
    case "email":
      return recipient.email;
  }
}

async function dispatchToChannel(
  clients: NotificationServiceClients,
  channel: NotificationChannel,
  destination: string | number,
  locale: Locale,
  payload: OrderCreatedPayload,
): Promise<string> {
  switch (channel) {
    case "sms": {
      const text = await buildOrderCreatedSms(locale, payload);
      const res = await clients.eskiz.sendSms({ phone: String(destination), text });
      return res.id;
    }
    case "telegram": {
      const tpl = await buildOrderCreatedTelegram(locale, payload);
      const res = await clients.telegram.sendMessage({
        chatId: destination,
        text: `${tpl.title}\n\n${tpl.body}`,
      });
      return String(res.messageId);
    }
    case "email": {
      const tpl = await buildOrderCreatedEmail(locale, payload);
      const res = await clients.resend.sendEmail({
        to: String(destination),
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return res.id;
    }
  }
}

interface WriteNotificationRowInput {
  type: NotificationType;
  channel: NotificationChannel;
  userId: string | null;
  locale: Locale;
  payload: Record<string, unknown>;
  sent: boolean;
}

async function writeNotificationRow(
  prisma: ExtendedPrismaClient,
  input: WriteNotificationRowInput,
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      channel: input.channel,
      locale: input.locale,
      payload: input.payload as never,
      sentAt: input.sent ? new Date() : null,
    },
  });
}
