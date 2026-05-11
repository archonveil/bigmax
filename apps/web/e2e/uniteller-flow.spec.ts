/**
 * P4-T12: full e2e Uniteller-flow через mock-server.
 *
 * Сценарии (§5.6 master-prompt + master-prompt P4-T12):
 *   1. **success** — happy path: mock возвращает Authorized → webhook
 *      обновляет Payment.captured + Order.confirmed; user редиректится
 *      на /success.
 *   2. **fail** — карта отклонена: mock возвращает NotAuthorized →
 *      Payment.failed; user → /failure.
 *   3. **timeout** — Uniteller "не ответил": mock не делает callback,
 *      редирект на URL_RETURN; Payment остаётся pending.
 *   4. **double** — двойной callback от mock (network retry): первый
 *      обрабатывается, второй идемпотентно отскакивает (WebhookEvent
 *      уже processed=true) → state не двигается; финал captured.
 *   5. **invalid_signature** — покрыт в `uniteller-webhook.spec.ts`
 *      (P4-T6) на уровне webhook-API. E2E через mock здесь не имеет
 *      смысла: app сам всегда отправляет валидную подпись.
 *   6. **COD** — покрыт в `checkout-cod.spec.ts` (P4-T8).
 *
 * Реализация — `page.route()` rewrite'ит исходящий POST на
 * `https://wpay.uniteller.ru/pay/` в `http://localhost:8787/pay/?test=<mode>`.
 * URL_RETURN_OK / URL_RETURN_NO / URL_RETURN указывают на наш dev-web,
 * куда mock 302'ит после auto-callback'а.
 *
 * Skip-логика: если mock не доступен (`/health` не отвечает) →
 * describe.skip(). Это позволяет запускать остальной e2e на CI без mock'а
 * (`E2E_BASE_URL` set, mock не auto-spawned).
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const MOCK_URL = process.env["E2E_MOCK_URL"] ?? "http://localhost:8787";
const USER = {
  email: "e2e-uniteller-flow@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Uniteller Flow",
};

async function isMockAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${MOCK_URL}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function resetMockState(): Promise<void> {
  await fetch(`${MOCK_URL}/admin/state`, { method: "DELETE" });
}

interface MockOrderState {
  orderId: string;
  status: string;
  callbacksSent: number;
  callbackBlocked: boolean;
}

async function getMockOrder(orderIdp: string): Promise<MockOrderState | null> {
  const res = await fetch(`${MOCK_URL}/admin/state/${orderIdp}`);
  if (res.status === 404) return null;
  const json = (await res.json()) as { ok: boolean; order?: MockOrderState };
  return json.order ?? null;
}

/**
 * Прокси POST на wpay.uniteller.ru/pay/ → mock-server. Используется
 * `route.fulfill` (не `route.continue`), потому что playwright требует
 * одинаковый протокол при redirect — а мы https → http.
 *
 * Mock-server синхронно дёргает callback на наш webhook ДО возврата 302,
 * поэтому к моменту fulfill'а БД уже обновлена.
 */
async function rewriteUnitellerToMock(page: Page, mode: string): Promise<void> {
  await page.route("https://wpay.uniteller.ru/pay/**", async (route) => {
    const postData = route.request().postData() ?? "";
    let res: Response;
    try {
      res = await fetch(`${MOCK_URL}/pay/?test=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: postData,
        redirect: "manual",
      });
    } catch (err) {
      await route.abort();
      throw err;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    await route.fulfill({
      status: res.status,
      headers,
      body: await res.text(),
    });
  });
}

test.describe("P4-T12 · Uniteller mock-server full flow", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMockAlive()), `mock-server недоступен на ${MOCK_URL} — skip`);
  });

  test.beforeEach(async ({ page }) => {
    await resetMockState();
    await page.goto("/ru");
    await page.evaluate(() => {
      localStorage.removeItem("bigmax:cart");
      localStorage.removeItem("bigmax:checkout-draft");
    });
    await createTestUser(USER);
    await page.goto("/ru/auth/login");
    await page.locator("input#email").fill(USER.email);
    await page.locator("input#password").fill(USER.password);
    await page.getByRole("button", { name: /^Войти$/ }).click();
    await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("success → captured + Order.confirmed + redirect /success", async ({ page }) => {
    await rewriteUnitellerToMock(page, "success");
    await fillCheckoutToReview(page);

    await page.getByRole("button", { name: /Оформить заказ/ }).click();
    await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 15_000 });

    const orderId = /\/orders\/([^/]+)\/success/.exec(page.url())?.[1];
    expect(orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId! },
      include: { payments: true },
    });
    expect(order.status).toBe("confirmed");
    expect(order.payments).toHaveLength(1);
    const pay = order.payments[0]!;
    expect(pay.status).toBe("captured");
    expect(pay.unitellerBillnumber).toMatch(/^MOCK-\d+/);
    expect(pay.unitellerResponseCode).toBe("00");
    expect(pay.capturedAt).not.toBeNull();

    // WebhookEvent.processed = true
    const events = await prisma.webhookEvent.findMany({
      where: { externalId: order.number },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.processed).toBe(true);
  });

  test("fail → Payment.failed + Order остаётся pending + redirect /failure", async ({ page }) => {
    await rewriteUnitellerToMock(page, "fail");
    await fillCheckoutToReview(page);

    await page.getByRole("button", { name: /Оформить заказ/ }).click();
    await page.waitForURL(/\/ru\/orders\/[^/]+\/failure/, { timeout: 15_000 });

    const orderId = /\/orders\/([^/]+)\/failure/.exec(page.url())?.[1];
    expect(orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId! },
      include: { payments: true },
    });
    // Order.status НЕ confirmed — failed-callback не подтверждает заказ
    expect(order.status).toBe("pending");
    expect(order.payments[0]!.status).toBe("failed");
    expect(order.payments[0]!.unitellerResponseCode).toBe("05");
    expect(order.payments[0]!.capturedAt).toBeNull();
  });

  test("timeout → нет callback'а → Payment остаётся pending + redirect /return", async ({
    page,
  }) => {
    await rewriteUnitellerToMock(page, "timeout");
    await fillCheckoutToReview(page);

    await page.getByRole("button", { name: /Оформить заказ/ }).click();
    await page.waitForURL(/\/ru\/orders\/[^/]+\/return/, { timeout: 15_000 });

    const orderId = /\/orders\/([^/]+)\/return/.exec(page.url())?.[1];
    expect(orderId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId! },
      include: { payments: true },
    });
    expect(order.status).toBe("pending");
    expect(order.payments[0]!.status).toBe("pending");

    // Mock запомнил заказ как Waiting и НЕ слал callback
    const mockState = await getMockOrder(order.number);
    expect(mockState).not.toBeNull();
    expect(mockState!.status).toBe("Waiting");
    expect(mockState!.callbacksSent).toBe(0);

    // WebhookEvent тоже отсутствует (callback не пришёл)
    const events = await prisma.webhookEvent.findMany({
      where: { externalId: order.number },
    });
    expect(events).toHaveLength(0);
  });

  test("double callback → второй идемпотентно отскакивает, state captured", async ({ page }) => {
    await rewriteUnitellerToMock(page, "double");
    await fillCheckoutToReview(page);

    await page.getByRole("button", { name: /Оформить заказ/ }).click();
    await page.waitForURL(/\/ru\/orders\/[^/]+\/success/, { timeout: 15_000 });

    const orderId = /\/orders\/([^/]+)\/success/.exec(page.url())?.[1];
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId! },
      include: { payments: true },
    });
    expect(order.status).toBe("confirmed");
    expect(order.payments[0]!.status).toBe("captured");

    // Mock зафиксировал, что callback ушёл дважды
    const mockState = await getMockOrder(order.number);
    expect(mockState!.callbacksSent).toBe(2);

    // Webhook отработал второй callback идемпотентно — WebhookEvent
    // создан один раз (provider+externalId+signature unique), processed=true
    const events = await prisma.webhookEvent.findMany({
      where: { externalId: order.number },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.processed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillCheckoutToReview(page: Page): Promise<void> {
  await page.goto("/ru/product/nuby-cherry-pacifier");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/ru/checkout");

  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByRole("button", { name: /^Далее$/ }).click(); // delivery (courier default)
  await page.getByRole("button", { name: /^Далее$/ }).click(); // payment (uniteller default)

  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
}
