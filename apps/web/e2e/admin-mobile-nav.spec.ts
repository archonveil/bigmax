/**
 * P6-T1 follow-up: e2e для mobile drawer с AdminNav.
 *
 * Сценарии:
 *   1. Mobile viewport (sm) → видна кнопка-гамбургер, desktop-aside скрыт.
 *   2. Клик по гамбургеру → drawer Sheet открывается, виден AdminNav.
 *   3. Клик по link внутри drawer'а → пути меняются + drawer закрывается
 *      автоматически (effect на pathname).
 *   4. Desktop viewport (lg+) → гамбургер скрыт, desktop-aside виден.
 */

import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-mobile@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Mobile",
  role: "admin" as const,
};

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P6-T1 follow-up · admin mobile drawer", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
  });

  test.afterEach(async () => {
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("mobile viewport: hamburger виден, desktop-aside скрыт", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 }); // iPhone 14
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await expect(page.getByTestId("admin-mobile-menu-button")).toBeVisible();
    // Desktop-aside hidden lg:block — на mobile должен быть невидим.
    const desktopAside = page.locator("aside.hidden.lg\\:block");
    await expect(desktopAside).toBeHidden();
  });

  test("mobile: клик по гамбургеру → sheet открыт, AdminNav виден", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }

    await page.getByTestId("admin-mobile-menu-button").click();
    const menu = page.getByTestId("admin-mobile-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("admin-nav")).toBeVisible();
    // Dashboard-link active внутри Sheet'а тоже подсвечен.
    await expect(menu.getByTestId("admin-nav-dashboard")).toHaveAttribute("data-active", "true");
  });

  test("mobile: клик по link в drawer'е → переход + drawer закрывается", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await page.getByTestId("admin-mobile-menu-button").click();
    const menu = page.getByTestId("admin-mobile-menu");
    await expect(menu).toBeVisible();

    // Клик «Назад в магазин» (это работающая ссылка, не WIP). После
    // navigation pathname меняется → effect setOpen(false) → sheet hides.
    await menu.getByTestId("admin-nav-back-to-shop").click();
    await page.waitForURL(/\/ru\/?$/, { timeout: 10_000 });
    // На / (главной) sheet не рендерится вообще.
    await expect(page.getByTestId("admin-mobile-menu")).toHaveCount(0);
  });

  test("desktop viewport: hamburger скрыт, desktop-aside виден", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsAdmin(page);
    if (!page.url().includes("/admin")) {
      await page.goto("/ru/admin");
    }
    await expect(page.getByTestId("admin-mobile-menu-button")).toBeHidden();
    await expect(page.locator("aside.hidden.lg\\:block")).toBeVisible();
    // Desktop-aside содержит свой <AdminNav>.
    await expect(page.locator("aside.hidden.lg\\:block").getByTestId("admin-nav")).toBeVisible();
  });
});
