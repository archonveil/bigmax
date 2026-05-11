/**
 * Role-based middleware (P1-T5):
 *   - аноним → /admin            → redirect /{locale}/auth/login
 *   - customer → /admin          → redirect /{locale}
 *   - admin → /admin             → пропускает (404 пока, страница в P6)
 *   - залогиненный → /auth/login → redirect /{locale} или /{locale}/admin
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const CUSTOMER = { email: "e2e-customer@bigmax.uz", password: "e2ePass1234" };
const ADMIN = {
  email: "e2e-admin@bigmax.uz",
  password: "e2eAdmin1234",
  name: "E2E Admin",
  role: "admin" as const,
};

test.beforeAll(async () => {
  await createTestUser(CUSTOMER);
  await createTestUser(ADMIN);
});

test.afterAll(async () => {
  await deleteTestUser(CUSTOMER.email);
  await deleteTestUser(ADMIN.email);
});

async function signInViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const csrfRes = await request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  await request.post("/api/auth/callback/credentials", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    form: { csrfToken, email, password, redirect: "false" },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
}

test.describe("role-based middleware", () => {
  test("аноним → /ru/admin → redirect /ru/auth/login", async ({ request }) => {
    const res = await request.get("/ru/admin", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/ru/auth/login");
  });

  test("customer → /ru/admin → redirect /ru (silent)", async ({ browser }) => {
    const context = await browser.newContext();
    await signInViaApi(context.request, CUSTOMER.email, CUSTOMER.password);

    const res = await context.request.get("/ru/admin", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toMatch(/\/ru$/);

    await context.close();
  });

  test("admin → /ru/admin → middleware пропускает (404 т.к. страница в P6)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInViaApi(context.request, ADMIN.email, ADMIN.password);

    const res = await context.request.get("/ru/admin", { maxRedirects: 0 });
    // middleware не редиректит → Next отдаёт 404 (нет page.tsx для /admin до P6)
    expect(res.status()).toBe(404);

    await context.close();
  });

  test("admin → /ru/auth/login → redirect /ru/admin", async ({ browser }) => {
    const context = await browser.newContext();
    await signInViaApi(context.request, ADMIN.email, ADMIN.password);

    const res = await context.request.get("/ru/auth/login", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/ru/admin");

    await context.close();
  });

  test("customer → /ru/auth/login → redirect /ru (не /admin)", async ({ browser }) => {
    const context = await browser.newContext();
    await signInViaApi(context.request, CUSTOMER.email, CUSTOMER.password);

    const res = await context.request.get("/ru/auth/login", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/\/ru$/);
    expect(location).not.toContain("/admin");

    await context.close();
  });

  test("аноним → /ru/account/profile → redirect на login (auth-gate в layout)", async ({
    request,
  }) => {
    const res = await request.get("/ru/account/profile", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/auth/login");
  });
});
