/**
 * P7-T2 sub-task O: maintenance-banner.
 *
 * Если `brand.maintenance_message` (string feature) непустой — рендерится
 * глобальный banner поверх всех страниц. Admin меняет текст через
 * /admin/features/brand.maintenance_message → за ≤ 60s banner появляется.
 * Использует `getStringFeature` (P7-T2 sub-task H) — первый real-world
 * consumer string-API.
 *
 * **Не локализуется**: текст вводит admin на одном языке (как правило, ru).
 * Это компромисс v1 — для multi-lang banner понадобится 3 feature row или
 * JSON-структура. Для emergency-incident-сообщений одного языка достаточно.
 */

import { getStringFeature } from "@/server/features";

export const BRAND_MAINTENANCE_MESSAGE_FEATURE_KEY = "brand.maintenance_message";

/**
 * Возвращает текущий текст banner'а. Пустая строка → banner выключен
 * (caller должен не рендерить компонент).
 */
export async function getMaintenanceMessage(): Promise<string> {
  return getStringFeature(BRAND_MAINTENANCE_MESSAGE_FEATURE_KEY, "");
}
