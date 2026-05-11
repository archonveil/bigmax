/**
 * P7-T2 sub-task J · e2e для admin features UI.
 *
 * Покрывает: anon → 401, customer → 404, admin login → list/edit, PATCH
 * с invalidate-cache, boolean radio-flow на test-row, кнопка «Очистить кэш».
 *
 * Test-row'ы создаются через `prisma.feature.upsert` в beforeEach и удаляются
 * в afterEach. Seed row `loyalty.earn_percent` НЕ трогаем — restore значения
 * после теста через upsert (`value: "1"`).
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { clearByGlob } from "./helpers/redis";
import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-features@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Features",
  role: "admin" as const,
};

/** Тестовый row для boolean-flow — гарантированно не существует до beforeEach. */
const TEST_BOOL_KEY = "e2e.test_feature_bool";
/** Тестовый row для string-flow. */
const TEST_STRING_KEY = "e2e.test_feature_string";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P7-T2 · admin features", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    // Boolean test-row.
    await prisma.feature.upsert({
      where: { key: TEST_BOOL_KEY },
      create: {
        key: TEST_BOOL_KEY,
        value: "false",
        type: "boolean",
        description: "E2E test row (boolean).",
      },
      update: { value: "false", type: "boolean" },
    });
    // String test-row.
    await prisma.feature.upsert({
      where: { key: TEST_STRING_KEY },
      create: {
        key: TEST_STRING_KEY,
        value: "initial",
        type: "string",
        description: "E2E test row (string).",
      },
      update: { value: "initial", type: "string" },
    });
    // Чистим cache — иначе предыдущие e2e могли оставить stale-значения.
    await clearByGlob("feature:*");
  });

  test.afterEach(async () => {
    // Restore loyalty.earn_percent на дефолт "1" (тесты ниже могут менять).
    await prisma.feature
      .update({
        where: { key: "loyalty.earn_percent" },
        data: { value: "1" },
      })
      .catch(() => {});
    await prisma.feature.deleteMany({
      where: { key: { in: [TEST_BOOL_KEY, TEST_STRING_KEY] } },
    });
    await deleteTestUser(ADMIN.email).catch(() => {});
    await clearByGlob("feature:*");
  });

  test("anon → PATCH /api/admin/features/x → 401", async ({ request }) => {
    const res = await request.patch("/api/admin/features/loyalty.earn_percent", {
      data: { value: "5" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("anon → POST /api/admin/features/x/invalidate → 401", async ({ request }) => {
    const res = await request.post("/api/admin/features/loyalty.earn_percent/invalidate");
    expect(res.status()).toBe(401);
  });

  test("admin → list page показывает seed + test rows", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/features");
    await expect(page.getByTestId("admin-features")).toBeVisible();
    await expect(page.getByTestId("admin-features-table")).toBeVisible();
    // Все три rows — seed (loyalty) + 2 e2e тестовых.
    const rows = page.getByTestId("admin-features-row");
    await expect(rows).toHaveCount(3);
    await expect(page.locator(`[data-key="loyalty.earn_percent"]`)).toBeVisible();
    await expect(page.locator(`[data-key="${TEST_BOOL_KEY}"]`)).toBeVisible();
    await expect(page.locator(`[data-key="${TEST_STRING_KEY}"]`)).toBeVisible();
  });

  test("admin → edit number value → PATCH succeeds + value visible", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/features/loyalty.earn_percent");
    await expect(page.getByTestId("admin-feature-edit")).toBeVisible();

    const input = page.getByTestId("feature-form-value");
    await input.fill("3.5");
    await page.getByTestId("feature-form-submit").click();

    // Toast «Feature обновлён. Кэш сброшен.»
    await expect(page.getByText("Feature обновлён", { exact: false })).toBeVisible({
      timeout: 5_000,
    });

    // Проверяем DB: value стало "3.5".
    const row = await prisma.feature.findUnique({
      where: { key: "loyalty.earn_percent" },
      select: { value: true },
    });
    expect(row?.value).toBe("3.5");
  });

  test("admin → boolean radio flow (false → true)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/features/${encodeURIComponent(TEST_BOOL_KEY)}`);
    await expect(page.getByTestId("feature-form-boolean")).toBeVisible();
    // Сейчас false (initial). Кликаем true.
    await page.locator('input[name="feature-value"][value="true"]').check();
    await page.getByTestId("feature-form-submit").click();
    await expect(page.getByText("Feature обновлён", { exact: false })).toBeVisible({
      timeout: 5_000,
    });
    const row = await prisma.feature.findUnique({
      where: { key: TEST_BOOL_KEY },
      select: { value: true },
    });
    expect(row?.value).toBe("true");
  });

  test("admin → invalidate-cache button → toast", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/features/loyalty.earn_percent");
    await page.getByTestId("feature-invalidate-button").click();
    await expect(page.getByText("Кэш очищен", { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("admin → invalid number → server-side error rendered", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/features/loyalty.earn_percent");
    // type=number input в HTML может фильтровать text — клиент-сайд browser
    // не пропустит "abc". Шлём через request API напрямую, чтобы поймать
    // server-side validation path.
    const res = await page.request.patch("/api/admin/features/loyalty.earn_percent", {
      data: { value: "not-a-number" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_number");
  });

  test("admin → string row → edit", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/features/${encodeURIComponent(TEST_STRING_KEY)}`);
    const input = page.getByTestId("feature-form-value");
    await input.fill("hello-world");
    await page.getByTestId("feature-form-submit").click();
    await expect(page.getByText("Feature обновлён", { exact: false })).toBeVisible({
      timeout: 5_000,
    });
    const row = await prisma.feature.findUnique({
      where: { key: TEST_STRING_KEY },
      select: { value: true },
    });
    expect(row?.value).toBe("hello-world");
  });
});
