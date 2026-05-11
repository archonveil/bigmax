/**
 * P6-T1: e2e для role-gated `/admin/*` (F13/§8 master-prompt).
 *
 * Защита проверяется в двух слоях:
 *   - **Middleware (edge)** — все четыре отказных сценария (anon/customer
 *     → redirect) ловятся до Next-handler'а.
 *   - **Layout (SSR)** — defense-in-depth: на admin/manager рендерим shell.
 *
 * Сценарии:
 *   1. Аноним на /admin → 302 на /auth/login.
 *   2. Customer на /admin → 302 на /{locale} (silent, не 403).
 *   3. Admin на /admin → 200 + render shell + landing-stub + nav.
 *   4. Manager на /admin → 200 + render (как admin), badge показывает manager.
 *   5. Header показывает «Админ-панель» link для privileged юзера.
 *   6. После login admin/manager → редирект сразу на /admin (middleware §1).
 */

import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const CUSTOMER = {
  email: "e2e-admin-customer@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Customer",
};
const ADMIN = {
  email: "e2e-admin-user@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin",
  role: "admin" as const,
};
const MANAGER = {
  email: "e2e-admin-manager@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Manager",
  role: "manager" as const,
};

async function loginAs(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(user.email);
  await page.locator("input#password").fill(user.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  // Не ждём конкретного URL — middleware редиректит admin'а на /admin,
  // customer'а на /. Просто ждём что мы уехали с /auth/.
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P6-T1 · /admin role-gate", () => {
  test.afterEach(async () => {
    await deleteTestUser(CUSTOMER.email).catch(() => {});
    await deleteTestUser(ADMIN.email).catch(() => {});
    await deleteTestUser(MANAGER.email).catch(() => {});
  });

  test("аноним → redirect на /auth/login", async ({ page }) => {
    await page.goto("/ru/admin");
    await page.waitForURL(/\/ru\/auth\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/auth/login");
  });

  test("customer → redirect на /{locale} (silent, не 403)", async ({ page }) => {
    await createTestUser(CUSTOMER);
    await loginAs(page, CUSTOMER);
    // После логина customer попадает на /ru. Прямой visit /admin отскочит
    // к /ru обратно.
    await page.goto("/ru/admin");
    await page.waitForURL(/\/ru\/?$/, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/ru\/?$/);
    // На /ru (главной) admin-shell не должен рендериться.
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });

  test("admin → 200 + admin shell + landing", async ({ page }) => {
    await createTestUser(ADMIN);
    await loginAs(page, ADMIN);
    // Middleware редиректит admin/manager на /admin сразу после логина —
    // если уже там, page.goto можно опустить, но сделаем явно.
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await expect(page.getByTestId("admin-shell")).toBeVisible();
    await expect(page.getByTestId("admin-landing")).toBeVisible();
    // На desktop layout рендерит TWO копии RoleBadge (mobile-header +
    // desktop-aside) — берём первую встретившуюся, она admin в обоих.
    await expect(page.getByTestId("admin-role-badge").first()).toHaveAttribute(
      "data-role",
      "admin",
    );
    // Desktop-aside содержит nav (mobile sheet тоже его рендерит, но он закрыт).
    await expect(page.locator("aside.hidden.lg\\:block").getByTestId("admin-nav")).toBeVisible();
  });

  test("manager → 200 + admin shell + role-badge=manager", async ({ page }) => {
    await createTestUser(MANAGER);
    await loginAs(page, MANAGER);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await expect(page.getByTestId("admin-shell")).toBeVisible();
    // Скоупим к aside (desktop) — на нашем viewport это видимая копия;
    // mobile-header `lg:hidden` рендерит дубль, но он невидим.
    const desktopBadge = page.locator("aside.hidden.lg\\:block").getByTestId("admin-role-badge");
    await expect(desktopBadge).toHaveAttribute("data-role", "manager");
    await expect(desktopBadge.getByText("Менеджер")).toBeVisible();
  });

  test("залогиненный admin визитит /auth/login → middleware §1 ведёт на /admin", async ({
    page,
  }) => {
    await createTestUser(ADMIN);
    await loginAs(page, ADMIN);
    // Повторный визит /auth/login для уже-залогиненного → middleware
    // редиректит admin/manager на /admin (vs /{locale} для customer'а).
    await page.goto("/ru/auth/login");
    await page.waitForURL(/\/ru\/admin\/?/, { timeout: 10_000 });
    expect(page.url()).toContain("/admin");
  });

  test("header показывает «Админ-панель» link для privileged", async ({ page }) => {
    await createTestUser(ADMIN);
    await loginAs(page, ADMIN);
    // Заходим на главную — там виден header.
    await page.goto("/ru");
    await expect(page.getByTestId("header-admin-link")).toBeVisible();
    await page.getByTestId("header-admin-link").click();
    await page.waitForURL(/\/ru\/admin\/?$/, { timeout: 10_000 });
    expect(page.url()).toContain("/admin");
  });

  test("header НЕ показывает admin-link для customer", async ({ page }) => {
    await createTestUser(CUSTOMER);
    await loginAs(page, CUSTOMER);
    await page.goto("/ru");
    await expect(page.getByTestId("header-admin-link")).toHaveCount(0);
  });

  test("admin-nav: dashboard helper подсвечен active на /admin", async ({ page }) => {
    await createTestUser(ADMIN);
    await loginAs(page, ADMIN);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await expect(page.getByTestId("admin-nav-dashboard")).toHaveAttribute("data-active", "true");
    // WIP-разделы НЕ active.
    await expect(page.getByTestId("admin-nav-orders")).toHaveAttribute("data-active", "false");
  });
});
