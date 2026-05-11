/**
 * Zod-схемы для credentials-провайдеров NextAuth. Используются в authorize()
 * и в route-handler'е `POST /api/auth/otp/request`.
 */

import { LocaleSchema } from "@bigmax/shared-types";
import { z } from "zod";

export const OtpRequestSchema = z.object({
  phone: z.string().min(9),
  locale: LocaleSchema.optional(),
});

export const OtpCredentialsSchema = z.object({
  phone: z.string().min(9),
  code: z.string().regex(/^\d{6}$/u, "OTP must be exactly 6 digits"),
});

export const EmailCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

/**
 * Payload Telegram Login Widget'а. NextAuth `signIn` сериализует все
 * credentials как строки (form-encoded), поэтому id/auth_date приходят
 * строками — coerce'им к нужным типам, hash валидируем как 64-hex.
 */
export const TelegramCredentialsSchema = z.object({
  id: z.string().regex(/^\d+$/u, "Telegram id must be numeric"),
  first_name: z.string().max(200).optional(),
  last_name: z.string().max(200).optional(),
  username: z.string().max(200).optional(),
  photo_url: z.string().url().max(2048).optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/iu, "Telegram hash must be 64-hex"),
});

export const RegisterEmailSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

/**
 * Same as `RegisterEmailSchema` but requires explicit acceptance of the
 * public offer / user agreement / privacy policy. Used by the registration
 * route handler — `RegisterEmailSchema` itself stays unchanged so it can be
 * reused in NextAuth's `authorize()` (login) without forcing a flag there.
 */
export const RegisterEmailRequestSchema = RegisterEmailSchema.extend({
  agreement: z.literal(true),
});

export const ProfileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  language: LocaleSchema.optional(),
  // Допускаем установку email только если у пользователя его ещё нет —
  // смена существующего адреса требует верификации и ждёт P4-T10.
  email: z.string().email().optional(),
});

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6).max(100),
});

export type OtpRequestInput = z.infer<typeof OtpRequestSchema>;
export type OtpCredentialsInput = z.infer<typeof OtpCredentialsSchema>;
export type EmailCredentialsInput = z.infer<typeof EmailCredentialsSchema>;
export type TelegramCredentialsInput = z.infer<typeof TelegramCredentialsSchema>;
export type RegisterEmailInput = z.infer<typeof RegisterEmailSchema>;
export type RegisterEmailRequestInput = z.infer<typeof RegisterEmailRequestSchema>;
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof PasswordChangeSchema>;
