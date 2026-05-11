/**
 * Zod-зеркала всех enum'ов из @bigmax/db / prisma schema.
 *
 * Зачем отдельно от Prisma Client: Zod-схемы используются на границе API
 * (validate body/query) и позволяют отсекать невалидные значения до входа
 * в бизнес-логику. Значения здесь обязаны быть в точности как в
 * prisma/schema.prisma — иначе compile-time хелпер `assertEnumsInSync`
 * в тестах упадёт.
 */

import { z } from "zod";

export const UserRoleSchema = z.enum(["customer", "admin", "manager"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const GenderSchema = z.enum(["unisex", "boy", "girl"]);
export type Gender = z.infer<typeof GenderSchema>;

export const OrderStatusSchema = z.enum([
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const DeliveryMethodSchema = z.enum(["courier", "pickup"]);
export type DeliveryMethod = z.infer<typeof DeliveryMethodSchema>;

export const PaymentProviderSchema = z.enum(["uniteller", "cod"]);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const PaymentStatusSchema = z.enum([
  "pending",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const RefundStatusSchema = z.enum(["pending", "completed", "failed"]);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const CardBrandSchema = z.enum(["visa", "mastercard", "mir", "other"]);
export type CardBrand = z.infer<typeof CardBrandSchema>;

export const PromoTypeSchema = z.enum(["percent", "fixed", "free_delivery"]);
export type PromoType = z.infer<typeof PromoTypeSchema>;

export const LoyaltyTypeSchema = z.enum(["earn", "spend"]);
export type LoyaltyType = z.infer<typeof LoyaltyTypeSchema>;

export const NotificationChannelSchema = z.enum(["telegram", "sms", "email"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// Locale и Zod-схему для неё держим в одном месте с константой LOCALES.
import { LOCALES } from "./locales";

export const LocaleSchema = z.enum(LOCALES);
