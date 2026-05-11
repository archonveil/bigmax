/**
 * Uniteller mock-server (P4-T12 — полная логика).
 *
 * Replicates production Uniteller's three core endpoints (`/pay/`, `/results/`,
 * `/cancel/`) close enough to drive end-to-end tests of the Бигмах payment
 * flow without leaving the local network. Сюда же добавлены `/admin/*`
 * endpoints для детерминированного управления mock'ом из Playwright.
 *
 * Поведение (§5.4–§5.9 master-prompt):
 *
 * 1. **POST /pay/** — приём formdata, валидация Signature через
 *    `verifyPayForm` (mock-helpers.ts), сохранение state, выбор сценария
 *    через query `?test=success|fail|timeout|double` (см. `decidePayAction`).
 *    Для не-timeout сценариев — sync POST callback на `MOCK_WEBHOOK_BASE/api/
 *    webhooks/uniteller` (или `?webhookBase=...` query override) с правильно
 *    подписанным Signature, затем 302 на `URL_RETURN_OK`/`URL_RETURN_NO`.
 *    Для timeout — никаких callback'ов, 302 на `URL_RETURN`.
 *
 * 2. **GET /results/** — XML с текущим состоянием Order_IDP из in-memory
 *    state-map. Возвращает 200 + список (потенциально пустой) даже если
 *    заказ незнаком — Uniteller тоже не различает «404» и «нет совпадений».
 *
 * 3. **POST /cancel/** — переводит state в `Canceled` + XML.
 *
 * 4. `GET /admin/state/:orderId` — снимок state для assertion'ов.
 * 5. `POST /admin/timeout/:orderId` — блокирует следующий callback.
 * 6. `DELETE /admin/state` — очистка state-map для clean test setup.
 * 7. `GET /health` — для healthcheck в docker-compose.
 *
 * Запуск:
 *   - Docker: `Dockerfile.mock` копирует `mock-server.ts` + `mock-helpers.ts`
 *     + `signature.ts` + `constants.ts`, запускает Node 22 с
 *     `--experimental-strip-types`.
 *   - Локально: `pnpm --filter @bigmax/payments mock:dev` через `tsx`.
 *   - Playwright e2e webServer (см. `playwright.config.ts`).
 *
 * Env:
 *   - `MOCK_PORT` (default 8787)
 *   - `MOCK_PASSWORD` — должен совпадать с `UNITELLER_PASSWORD` приложения,
 *     иначе Signature не сойдётся и `/pay/` будет 400'ить.
 *   - `MOCK_WEBHOOK_BASE` — base URL webhook'а (default
 *     `http://localhost:3030`, для docker — `http://host.docker.internal:3030`).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import {
  blockCallback,
  buildCallbackBody,
  createState,
  decidePayAction,
  parseTestMode,
  recordCallbackSent,
  renderResultsXml,
  setOrderStatus,
  upsertOrder,
  verifyPayForm,
  type MockState,
} from "./mock-helpers";

const PORT = Number(process.env["MOCK_PORT"] ?? 8787);
const SERVICE = "uniteller-mock";
const PASSWORD = process.env["MOCK_PASSWORD"] ?? "bigmax-dev-placeholder-change-in-prod";
const DEFAULT_WEBHOOK_BASE = process.env["MOCK_WEBHOOK_BASE"] ?? "http://localhost:3030";

const state: MockState = createState();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function log(method: string, path: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  // eslint-disable-next-line no-console
  console.info(`[${SERVICE}] ${method} ${path}${payload}`);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendXml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/xml; charset=utf-8" });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

// ---------------------------------------------------------------------------
// Send callback to magazine webhook
// ---------------------------------------------------------------------------

async function postCallback(webhookBase: string, body: string): Promise<number> {
  const url = `${webhookBase.replace(/\/$/, "")}/api/webhooks/uniteller`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return res.status;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${SERVICE}] callback failed`, err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handlePay(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const body = await readBody(req);
  const params = new URLSearchParams(body);

  const shopId = params.get("Shop_IDP") ?? "";
  const orderId = params.get("Order_IDP") ?? "";
  const subtotal = params.get("Subtotal_P") ?? "";
  const signature = params.get("Signature") ?? "";
  const returnOk = params.get("URL_RETURN_OK") ?? "";
  const returnNo = params.get("URL_RETURN_NO") ?? "";
  const returnUrl = params.get("URL_RETURN") ?? "";

  log("POST", "/pay/", { orderId, mode: url.searchParams.get("test") ?? "success" });

  const verify = verifyPayForm({ shopId, orderId, subtotal, signature, password: PASSWORD });
  if (!verify.ok) {
    sendText(res, 400, `Bad Request: ${verify.reason}`);
    return;
  }

  const mode = parseTestMode(url.searchParams.get("test"));
  const billnumber = `MOCK-${Date.now()}`;
  const cardMask = mode === "fail" ? "4000 **** **** 2479" : "4000 **** **** 2487";

  // Запоминаем state — потом /results/ его отдаст pull-job'у.
  upsertOrder(state, orderId, {
    status: mode === "fail" ? "NotAuthorized" : mode === "timeout" ? "Waiting" : "Authorized",
    subtotal,
    billnumber,
    cardMask,
  });

  const decision = decidePayAction({
    mode,
    returnOkUrl: returnOk,
    returnNoUrl: returnNo,
    returnUrl,
  });

  if (decision.kind === "no_callback_redirect") {
    redirect(res, decision.redirectTo);
    return;
  }

  // Callback synchronously to ensure state is updated before user lands on
  // success page (prevents race in e2e). Webhook base override via query
  // (priority: query param → env → localhost:3030).
  const webhookBase = url.searchParams.get("webhookBase") ?? DEFAULT_WEBHOOK_BASE;
  const cbBody = buildCallbackBody({
    orderId,
    status: decision.status,
    password: PASSWORD,
    billnumber,
    cardMask,
  });

  const stored = state.get(orderId);
  if (stored?.callbackBlocked) {
    log("POST", "/pay/", { orderId, note: "callback blocked by /admin/timeout" });
  } else {
    for (let i = 0; i < decision.times; i += 1) {
      const status = await postCallback(webhookBase, cbBody);
      recordCallbackSent(state, orderId);
      log("→ webhook", `${webhookBase}/api/webhooks/uniteller`, { status, attempt: i + 1 });
    }
  }

  redirect(res, decision.redirectTo);
}

function handleResults(res: ServerResponse, url: URL): void {
  const orderId = url.searchParams.get("Order_ID") ?? "";
  log("GET", "/results/", { orderId });

  if (orderId === "") {
    // Без фильтра — отдаём все. Боевой Uniteller тоже умеет диапазон по дате,
    // но здесь scope теста — single-order pull.
    sendXml(res, 200, renderResultsXml([...state.values()]));
    return;
  }
  const order = state.get(orderId);
  sendXml(res, 200, renderResultsXml(order ? [order] : []));
}

async function handleCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const orderId = params.get("Order_ID") ?? params.get("OrderID") ?? "";
  log("POST", "/cancel/", { orderId });

  if (orderId === "") {
    sendText(res, 400, "Bad Request: Order_ID required");
    return;
  }
  const updated = setOrderStatus(state, orderId, "Canceled");
  if (!updated) {
    // Для unknown order создаём «фиктивный» Canceled — Uniteller тоже не падает.
    upsertOrder(state, orderId, {
      status: "Canceled",
      subtotal: "0.00",
      billnumber: "",
      cardMask: "",
    });
  }
  sendXml(res, 200, renderResultsXml(state.get(orderId) ? [state.get(orderId)!] : []));
}

function handleAdminState(res: ServerResponse, url: URL, method: string): void {
  if (method === "DELETE") {
    state.clear();
    log("DELETE", "/admin/state");
    sendJson(res, 200, { ok: true, cleared: true });
    return;
  }

  // GET /admin/state/:orderId | GET /admin/state
  const parts = url.pathname.split("/").filter(Boolean);
  const orderId = parts[2]; // /admin/state/<orderId>
  if (!orderId) {
    log(method, "/admin/state");
    sendJson(res, 200, { ok: true, orders: [...state.values()] });
    return;
  }
  const order = state.get(orderId);
  log(method, `/admin/state/${orderId}`, { found: order !== undefined });
  if (!order) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }
  sendJson(res, 200, { ok: true, order });
}

function handleAdminTimeout(res: ServerResponse, url: URL): void {
  const parts = url.pathname.split("/").filter(Boolean);
  const orderId = parts[2]; // /admin/timeout/<orderId>
  if (!orderId) {
    sendJson(res, 400, { ok: false, error: "orderId required" });
    return;
  }
  const blocked = blockCallback(state, orderId);
  log("POST", `/admin/timeout/${orderId}`, { blocked });
  if (!blocked) {
    // Pre-create state так, чтобы последующий POST /pay/ увидел блок.
    upsertOrder(state, orderId, {
      status: "Waiting",
      subtotal: "",
      billnumber: "",
      cardMask: "",
    });
    blockCallback(state, orderId);
  }
  sendJson(res, 200, { ok: true, orderId, callbackBlocked: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: SERVICE, mode: "full", orders: state.size });
      return;
    }
    if (method === "POST" && url.pathname === "/pay/") {
      await handlePay(req, res, url);
      return;
    }
    if (method === "GET" && url.pathname === "/results/") {
      handleResults(res, url);
      return;
    }
    if (method === "POST" && url.pathname === "/cancel/") {
      await handleCancel(req, res);
      return;
    }
    if (url.pathname.startsWith("/admin/state")) {
      handleAdminState(res, url, method);
      return;
    }
    if (method === "POST" && url.pathname.startsWith("/admin/timeout/")) {
      handleAdminTimeout(res, url);
      return;
    }

    log(method, url.pathname, { status: 404 });
    sendText(res, 404, "Not found");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${SERVICE}] handler error`, err);
    sendText(res, 500, "Internal error");
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.info(`[${SERVICE}] listening on :${PORT} (webhook → ${DEFAULT_WEBHOOK_BASE})`);
});

const shutdown = (signal: string): void => {
  // eslint-disable-next-line no-console
  console.info(`[${SERVICE}] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Файл — runtime entry point. Импортировать его из других модулей не нужно
// (это запустило бы listen на :8787). Pure helpers живут в mock-helpers.ts.
