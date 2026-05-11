/**
 * `@bigmax/notifications` — public API.
 *
 * Каналы:
 *   - `eskiz/`     — SMS Uzbekistan (Eskiz.uz, sender `BIGMAX`).
 *   - `telegram/`  — Telegram Bot API (бот @bigmax_shop_bot, канал @bigmax_uz).
 *   - `resend/`    — email через Resend (orders@bigmax.uz).
 *
 * Шаблоны:
 *   - `templates/otp.ts`           — OTP-SMS (P1-T1).
 *   - `templates/order/created.ts` — `order_created` для всех 3 каналов (P4-T10).
 *   - `order_status_changed`, `order_delivered` — заглушки до P6-T5/T6.
 *
 * Диспетчер:
 *   - `service.ts::sendOrderCreated` — рендерит + отправляет + пишет
 *     `Notification`-row. Вызывается из BullMQ-worker'а.
 */

// --- channels --------------------------------------------------------------
export { getEskizClient, setEskizClientForTesting } from "./eskiz";
export type { EskizClient, SendSmsInput, SendSmsResult } from "./eskiz/types";

export {
  getTelegramClient,
  setTelegramClientForTesting,
  createTelegramMockClient,
} from "./telegram";
export type {
  TelegramClient,
  SendTelegramMessageInput,
  SendTelegramMessageResult,
} from "./telegram";

export { getResendClient, setResendClientForTesting, createResendMockClient } from "./resend";
export type { ResendClient, SendEmailInput, SendEmailResult } from "./resend";

// --- templates -------------------------------------------------------------
export { buildOtpSmsText } from "./templates/otp";
export {
  buildOrderCreatedSms,
  buildOrderCreatedTelegram,
  buildOrderCreatedEmail,
  type OrderCreatedPayload,
  type OrderCreatedTelegramText,
  type OrderCreatedEmailText,
} from "./templates/order/created";
export {
  buildPasswordResetEmail,
  type PasswordResetEmailInput,
  type PasswordResetEmailOutput,
} from "./templates/password-reset";

// --- service / dispatcher --------------------------------------------------
export {
  sendOrderCreated,
  type ChannelResult,
  type NotificationChannel,
  type NotificationRecipient,
  type NotificationServiceClients,
  type NotificationType,
  type SendOrderCreatedInput,
} from "./service";

// --- queue / enqueue (BullMQ) ---------------------------------------------
export {
  NOTIFICATIONS_QUEUE_NAME,
  closeNotificationQueue,
  enqueueOrderCreatedNotification,
  getNotificationQueue,
  setNotificationQueueForTesting,
} from "./queue";
