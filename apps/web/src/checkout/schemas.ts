/**
 * Zod-схемы для per-step валидации чекаута. Все optional string-поля используют
 * `z.string().default("")` без `.transform((v) => v === "" ? null : v)`. Это
 * сохраняет invariant'ы:
 *   - RHF `defaultValues` принимает strings (не null) → не надо escape через
 *     `as unknown as T`.
 *   - Output-type схемы совпадает с Input-type — proper inference.
 *   - Конверсия `""` → `null` произойдёт в P4-T5 при записи в БД
 *     (`Order.comment`, `Address.district` и т.п.) — schema обе формы примет.
 */

import { isUzRegionSlug, UZ_PHONE_REGEX } from "@bigmax/shared-types";
import { z } from "zod";

// === Step 1: Contacts =======================================================

export const ContactsStepSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().regex(UZ_PHONE_REGEX, { message: "invalid_phone" }),
});

export type ContactsStepInput = z.infer<typeof ContactsStepSchema>;

// === Step 2: Address ========================================================

/** Optional string: пустая строка = «не указано». */
const optionalString = (max: number) => z.string().trim().max(max).default("");

export const AddressStepSchema = z.object({
  region: z.string().refine(isUzRegionSlug, { message: "invalid_region" }),
  city: z.string().trim().min(1).max(100),
  district: optionalString(100),
  street: z.string().trim().min(1).max(200),
  house: z.string().trim().min(1).max(50),
  apartment: optionalString(50),
  landmark: optionalString(200),
  phone: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || UZ_PHONE_REGEX.test(v), { message: "invalid_phone" }),
});

export type AddressStepInput = z.infer<typeof AddressStepSchema>;

// === Step 3: Delivery =======================================================

export const DeliveryStepSchema = z
  .object({
    method: z.enum(["courier", "pickup"]),
    branchId: z.string().trim().default(""),
    comment: z.string().trim().max(500).default(""),
  })
  .refine((d) => d.method !== "pickup" || d.branchId.length > 0, {
    path: ["branchId"],
    message: "branch_required",
  });

export type DeliveryStepInput = z.infer<typeof DeliveryStepSchema>;

// === Step 4: Payment ========================================================

export const PaymentStepSchema = z.object({
  method: z.enum(["uniteller", "cod", "uzum"]),
});

export type PaymentStepInput = z.infer<typeof PaymentStepSchema>;
