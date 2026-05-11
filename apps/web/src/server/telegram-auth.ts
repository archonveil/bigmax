/**
 * Telegram Login Widget — server-side payload verification.
 *
 * Виджет (https://core.telegram.org/widgets/login) рендерит кнопку, которая
 * после подтверждения юзером отдаёт нам подписанный payload. Подпись —
 * HMAC-SHA256(data_check_string, SHA256(bot_token)) — гарантирует, что
 * payload не сфабрикован и пришёл от Telegram'а.
 *
 *   data_check_string = sorted "key=value" pairs, joined by "\n",
 *                       все поля payload КРОМЕ `hash`.
 *   secret_key        = SHA256(bot_token)
 *   expected          = HMAC-SHA256(data_check_string, secret_key)
 *
 * Дополнительно проверяем `auth_date` — отбрасываем payload старше
 * `MAX_AUTH_AGE_SECONDS` (защита от replay).
 *
 * Bot token читается из `TELEGRAM_BOT_TOKEN` (уже используется в
 * `@bigmax/notifications/telegram` для уведомлений). Если переменная не
 * задана — verify всегда возвращает false (нельзя авторизовать без секрета).
 */

import crypto from "node:crypto";

const MAX_AUTH_AGE_SECONDS = 5 * 60; // 5 минут

export interface TelegramAuthPayload {
  id: string;
  first_name?: string | undefined;
  last_name?: string | undefined;
  username?: string | undefined;
  photo_url?: string | undefined;
  auth_date: number;
  hash: string;
}

/**
 * Проверяет HMAC-подпись payload'а Telegram Login Widget.
 * Возвращает `true`, если подпись валидна И auth_date свежий.
 */
export function verifyTelegramAuth(payload: TelegramAuthPayload): boolean {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  if (!botToken || botToken.trim() === "") return false;

  // Freshness check — отбрасываем старые payload'ы (replay protection).
  const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
  if (ageSeconds < 0 || ageSeconds > MAX_AUTH_AGE_SECONDS) return false;

  // Build data_check_string из всех полей кроме `hash`. Telegram требует
  // лексикографическую сортировку ключей и формат `key=value`, разделители — \n.
  const fields: Record<string, string | number> = {
    id: payload.id,
    auth_date: payload.auth_date,
  };
  if (payload.first_name !== undefined) fields["first_name"] = payload.first_name;
  if (payload.last_name !== undefined) fields["last_name"] = payload.last_name;
  if (payload.username !== undefined) fields["username"] = payload.username;
  if (payload.photo_url !== undefined) fields["photo_url"] = payload.photo_url;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${String(fields[k])}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Constant-time compare — защита от timing-атак.
  const provided = Buffer.from(payload.hash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
