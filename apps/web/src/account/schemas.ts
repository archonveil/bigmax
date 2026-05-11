/**
 * Zod-схемы адресов доставки. Используются и API, и клиент-формами.
 *
 * Принцип минимальных обязательных полей: region + city. Остальное
 * (улица, дом, квартира, ориентир, телефон) — опционально, чтобы не
 * заставлять юзера заполнять всё сразу. Доставка проверит полноту
 * позже в checkout'е (P4).
 */

import { isUzRegionSlug, UZ_PHONE_REGEX } from "@bigmax/shared-types";
import { z } from "zod";

const phoneField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || UZ_PHONE_REGEX.test(v), {
    message: "invalid_phone",
  });

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const AddressCreateSchema = z.object({
  region: z.string().refine(isUzRegionSlug, { message: "invalid_region" }),
  city: z.string().trim().min(1).max(100),
  district: optionalTrimmed(100),
  street: optionalTrimmed(200),
  house: optionalTrimmed(50),
  apartment: optionalTrimmed(50),
  landmark: optionalTrimmed(200),
  phone: phoneField,
  isDefault: z.boolean().optional(),
});

export const AddressUpdateSchema = AddressCreateSchema.partial();

export type AddressCreateInput = z.infer<typeof AddressCreateSchema>;
export type AddressUpdateInput = z.infer<typeof AddressUpdateSchema>;
