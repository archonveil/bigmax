/**
 * HTTP-клиент Uniteller `/results/` (§5.8 master-prompt).
 *
 * Scope для P4-T9 — только pull-проверка статуса. Создание платежа (POST /pay/)
 * выполняется напрямую из роута через self-submit форму (P4-T5), а отмена
 * платежа и возвраты (POST /cancel/) — приходят с P6-T6.
 *
 * Авторизация: HTTP Basic с `UNITELLER_AUTH_LOGIN` + `UNITELLER_AUTH_PASSWORD`
 * (§5.3, отдельные от формы-подписи `UNITELLER_PASSWORD`). Все запросы
 * server-only — секреты никогда не должны утечь в client bundle.
 */

import { UNITELLER } from "./constants";
import {
  UnitellerResultsItemSchema,
  UnitellerStatusSchema,
  type UnitellerResultsItem,
} from "./types";

/** Совместимый минимум `globalThis.fetch` для DI в тестах. */
type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Default network timeout (§5.12 — 30 сек). */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface FetchPaymentStatusInput {
  /** `Order_IDP` — `Order.number` в формате `BGX-YYYYMMDD-NNNN`. */
  orderId: string;
  /** `Shop_IDP` — `env.UNITELLER_SHOP_ID`. */
  shopId: string;
  /** `env.UNITELLER_AUTH_LOGIN`. */
  authLogin: string;
  /** `env.UNITELLER_AUTH_PASSWORD`. */
  authPassword: string;
  /** Custom fetch для тестов; по-умолчанию `globalThis.fetch`. */
  fetchImpl?: FetchImpl;
  /** Network/parse timeout. По-умолчанию 30 сек (§5.12). */
  timeoutMs?: number;
}

export type FetchPaymentStatusResult =
  | { kind: "ok"; items: UnitellerResultsItem[] }
  | { kind: "not_found"; httpStatus: number }
  | { kind: "auth_error"; httpStatus: number }
  | { kind: "network_error"; message: string }
  | { kind: "parse_error"; message: string };

/**
 * Запрос статуса платежа по Order_IDP. Uniteller возвращает XML
 * (`Format=XML`); в общем случае это список (если фильтр по дате), но при
 * запросе по конкретному `Order_ID` обычно один элемент.
 *
 * Не throw'ит — все ошибки возвращаются как discriminated union, чтобы
 * job-orchestrator мог осознанно решать что делать (retry, log, skip).
 */
export async function fetchPaymentStatus(
  input: FetchPaymentStatusInput,
): Promise<FetchPaymentStatusResult> {
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const url =
    `${UNITELLER.resultsUrl}?` +
    new URLSearchParams({
      Shop_IDP: input.shopId,
      Order_ID: input.orderId,
      Format: "XML",
    }).toString();

  const auth = Buffer.from(`${input.authLogin}:${input.authPassword}`, "utf8").toString("base64");
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError — таймаут истёк. Любые другие — сетевая ошибка.
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
    return {
      kind: "network_error",
      message: isAbort ? `timeout ${timeoutMs}ms` : err instanceof Error ? err.message : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "auth_error", httpStatus: res.status };
  }
  if (res.status === 404) {
    return { kind: "not_found", httpStatus: 404 };
  }
  if (!res.ok) {
    return { kind: "network_error", message: `http ${res.status}` };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return { kind: "parse_error", message: err instanceof Error ? err.message : "read failed" };
  }

  try {
    const items = parseResultsXml(body);
    return { kind: "ok", items };
  } catch (err) {
    return { kind: "parse_error", message: err instanceof Error ? err.message : "xml" };
  }
}

// ---------------------------------------------------------------------------
// Минимальный XML-парсер для `/results/` ответа Uniteller.
//
// Документация Uniteller v1.43+ говорит что ответ — flat XML без вложенностей
// и атрибутов:
//   <orders>
//     <order>
//       <orderid>BGX-...</orderid>
//       <status>Authorized</status>
//       <total>15000.00</total>
//       <billnumber>RRN-...</billnumber>
//       <approvalcode>00</approvalcode>
//       <lastmodified>2026-04-25 12:34:56</lastmodified>
//     </order>
//   </orders>
//
// Имена тегов нормализуем к camelCase. Не используем DOM-парсер чтобы не
// тащить deps; regex по `<order>...</order>` блоку и затем по тегам внутри.
// ---------------------------------------------------------------------------

const ORDER_BLOCK_RE = /<order>([\s\S]*?)<\/order>/gi;

const FIELD_MAP: Record<string, keyof UnitellerResultsItem> = {
  orderid: "OrderId",
  status: "Status",
  total: "Total",
  billnumber: "Billnumber",
  approvalcode: "ApprovalCode",
  lastmodified: "LastModified",
};

export function parseResultsXml(xml: string): UnitellerResultsItem[] {
  const items: UnitellerResultsItem[] = [];
  for (const match of xml.matchAll(ORDER_BLOCK_RE)) {
    const block = match[1] ?? "";
    const raw: Record<string, string> = {};
    // Извлекаем содержимое каждого тега первого уровня внутри <order>.
    for (const fieldMatch of block.matchAll(/<([a-zA-Z]+)>([^<]*)<\/\1>/g)) {
      const tag = fieldMatch[1]?.toLowerCase();
      const value = (fieldMatch[2] ?? "").trim();
      if (!tag) continue;
      const mapped = FIELD_MAP[tag];
      if (mapped) raw[mapped] = value;
    }
    if (raw["OrderId"] === undefined || raw["Status"] === undefined || raw["Total"] === undefined) {
      throw new Error("results XML: missing required fields");
    }
    // Status валидируем через Zod-enum — если Uniteller прислал что-то
    // незнакомое, лучше упасть, чем молча пропустить.
    UnitellerStatusSchema.parse(raw["Status"]);
    const parsed = UnitellerResultsItemSchema.parse(raw);
    items.push(parsed);
  }
  return items;
}

// ---------------------------------------------------------------------------
// POST /cancel/ — void авторизации (P5-T4 / §5.9 master-prompt)
// ---------------------------------------------------------------------------

export interface CancelPaymentInput {
  /** `Order_ID` — `Order.number` в формате `BGX-YYYYMMDD-NNNN`. */
  orderId: string;
  /** `Shop_IDP` — `env.UNITELLER_SHOP_ID`. */
  shopId: string;
  /** `env.UNITELLER_AUTH_LOGIN`. */
  authLogin: string;
  /** `env.UNITELLER_AUTH_PASSWORD`. */
  authPassword: string;
  /** RRN из последнего callback'а — Uniteller предпочитает Billnumber, но
   *  опционален: если нет, используется Order_ID. */
  billnumber?: string | null;
  /** Полная сумма платежа в формате Uniteller (`"15000.00"`). Опциональна;
   *  если не указана — Uniteller берёт исходную сумму. */
  subtotal?: string;
  /** Custom fetch для тестов. */
  fetchImpl?: FetchImpl;
  /** Network timeout. */
  timeoutMs?: number;
}

export type CancelPaymentResult =
  | { kind: "ok" }
  | { kind: "not_found"; httpStatus: number }
  | { kind: "auth_error"; httpStatus: number }
  | { kind: "network_error"; message: string }
  | { kind: "provider_error"; message: string };

/**
 * Posts `application/x-www-form-urlencoded` на `UNITELLER.cancelUrl`. Не
 * throw'ит — discriminated union для caller'а; route-handler решает какой
 * HTTP-status вернуть пользователю.
 *
 * Body (§5.9):
 *   - `Shop_IDP` — обязательно.
 *   - `Order_ID` — Order.number.
 *   - `Billnumber` — опционально, RRN.
 *   - `Subtotal` — опционально, для частичной отмены.
 *
 * Auth: HTTP Basic (`UNITELLER_AUTH_LOGIN`/`PASSWORD`) — те же креды что и
 * `/results/`. Из коробки шифруются TLS на стороне fetch'а.
 */
export async function cancelUnitellerPayment(
  input: CancelPaymentInput,
): Promise<CancelPaymentResult> {
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const auth = Buffer.from(`${input.authLogin}:${input.authPassword}`, "utf8").toString("base64");
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const params = new URLSearchParams({
    Shop_IDP: input.shopId,
    Order_ID: input.orderId,
  });
  if (input.billnumber) params.set("Billnumber", input.billnumber);
  if (input.subtotal) params.set("Subtotal", input.subtotal);

  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await fetchImpl(UNITELLER.cancelUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
    return {
      kind: "network_error",
      message: isAbort ? `timeout ${timeoutMs}ms` : err instanceof Error ? err.message : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "auth_error", httpStatus: res.status };
  }
  if (res.status === 404) {
    return { kind: "not_found", httpStatus: 404 };
  }
  if (!res.ok) {
    return { kind: "network_error", message: `http ${res.status}` };
  }

  // Тело Uniteller на cancel — XML с `<Status>Canceled</Status>`. На наш
  // happy-path достаточно факта 200; при `<Status>Error</Status>` отдаём
  // `provider_error`. Парсинг минимальный — без Zod, чтобы не разлапывать
  // схему на легаси-XML.
  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return {
      kind: "provider_error",
      message: err instanceof Error ? err.message : "read failed",
    };
  }
  if (/<Status>Canceled<\/Status>/i.test(body) || /<Status>Cancelled<\/Status>/i.test(body)) {
    return { kind: "ok" };
  }
  if (/<Status>Error<\/Status>/i.test(body) || /<error/i.test(body)) {
    const msgMatch = /<(?:Message|ErrorMessage)>([^<]*)<\/(?:Message|ErrorMessage)>/i.exec(body);
    return {
      kind: "provider_error",
      message: msgMatch?.[1]?.trim() ?? "unknown provider error",
    };
  }
  // Default: 200 без явного Status тоже считаем ok — некоторые ответы
  // Uniteller просто возвращают `<Order>...</Order>` без Status-узла.
  return { kind: "ok" };
}
