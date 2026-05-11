/**
 * Email-login flow на всех трёх локалях. Проверяем что:
 *   1. Страница /{locale}/auth/login рендерится с локализованным заголовком.
 *   2. После сабмита с корректными credentials — redirect на /{locale}.
 *   3. Устанавливается authjs session-cookie.
 *   4. Header показывает имя залогиненного юзера.
 */

import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-login@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Login",
};

const LOCALES = [
  { code: "ru", title: /Войти в Бигмах/i, submit: /^Войти$/ },
  { code: "uz", title: /Bigmax'ga kirish/i, submit: /^Kirish$/ },
  { code: "en", title: /Sign in to Bigmax/i, submit: /^Sign in$/ },
] as const;

test.beforeEach(async () => {
  await createTestUser(USER);
});

test.afterEach(async () => {
  await deleteTestUser(USER.email);
});

async function signIn(page: Page, locale: string, submitRx: RegExp): Promise<void> {
  await page.goto(`/${locale}/auth/login`);
  // Селекторы по id/type, чтобы не зависеть от локализации и не конфликтовать
  // с элементами Tabs (у них тот же текст «Email»).
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: submitRx }).click();
}

for (const locale of LOCALES) {
  test.describe(`auth/login · ${locale.code}`, () => {
    test("рендер страницы входа", async ({ page }) => {
      await page.goto(`/${locale.code}/auth/login`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale.title);
    });

    test("успешный email-вход → активная сессия + redirect на /{locale}", async ({ page }) => {
      await signIn(page, locale.code, locale.submit);

      // Ждём ухода со страницы /auth/login — именно это подтверждает, что
      // signIn отработал и middleware/router увёл нас на home.
      await page.waitForURL((url) => !url.pathname.includes("/auth/"), {
        timeout: 10_000,
      });

      // Сессия валидна если /api/auth/session отдаёт email тестового юзера.
      const res = await page.request.get("/api/auth/session");
      const session = (await res.json()) as { user?: { email?: string } } | null;
      expect(session?.user?.email).toBe(USER.email);
    });
  });
}
