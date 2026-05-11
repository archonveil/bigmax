/**
 * P6-T8 follow-up: e2e для закрытых open question'ов:
 *   (a) User.isBlocked: API + middleware-блокировка
 *   (c) /admin/audit page агрегирующий PaymentLog
 *   (d) Bulk role change
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-customers-fu@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Customers FU",
  role: "admin" as const,
};

const TARGET = {
  email: "e2e-target-customer-fu@bigmax.uz",
  password: "originalPass1234",
  name: "E2E Target FU",
  role: "customer" as const,
};

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P6-T8 follow-up · isBlocked + audit + bulk-role", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await createTestUser(TARGET);
  });

  test.afterEach(async () => {
    await deleteTestUser(TARGET.email).catch(() => {});
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("(a) POST /block → User.isBlocked=true + PaymentLog audit", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/customers/${target.id}/block`, {
      data: { reason: "Test block" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { isBlocked: true },
    });
    expect(reloaded.isBlocked).toBe(true);

    const log = await prisma.paymentLog.findFirst({
      where: {
        action: "user.blocked",
        request: { path: ["targetUserId"], equals: target.id },
      },
      select: { id: true },
    });
    expect(log).not.toBeNull();
  });

  test("(a) cannot_self_block → 409", async ({ page }) => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/customers/${adminUser.id}/block`, {
      data: { reason: "Try self-block" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("cannot_self_block");
  });

  test("(a) already_blocked + not_blocked idempotency", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: target.id }, data: { isBlocked: true } });

    await loginAsAdmin(page);
    const blockRes = await page.request.post(`/api/admin/customers/${target.id}/block`, {
      data: { reason: "Try double-block" },
      headers: { "Content-Type": "application/json" },
    });
    expect(blockRes.status()).toBe(409);
    expect((await blockRes.json()).reason).toBe("already_blocked");

    const unblockRes = await page.request.post(`/api/admin/customers/${target.id}/unblock`, {
      data: { reason: "Cleanup" },
      headers: { "Content-Type": "application/json" },
    });
    expect(unblockRes.status()).toBe(200);

    const doubleUnblock = await page.request.post(`/api/admin/customers/${target.id}/unblock`, {
      data: { reason: "Try double-unblock" },
      headers: { "Content-Type": "application/json" },
    });
    expect(doubleUnblock.status()).toBe(409);
    expect((await doubleUnblock.json()).reason).toBe("not_blocked");
  });

  test("(a) blocked user НЕ может залогиниться", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: target.id }, data: { isBlocked: true } });

    await page.goto("/ru/auth/login");
    await page.locator("input#email").fill(TARGET.email);
    await page.locator("input#password").fill(TARGET.password);
    await page.getByRole("button", { name: /^Войти$/ }).click();
    // Login должен fail'ить — остаёмся на /auth/login (или error-page).
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/auth/login");
  });

  test("(a) UI: block-dialog → toast + БД", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/customers/${target.id}`);
    await page.getByTestId("customer-block-trigger").click();
    await page.getByTestId("customer-block-reason").fill("UI smoke block test");
    await page.getByTestId("customer-block-submit").click();

    // Ждём router.refresh — детали должны показать badge.
    await expect(page.getByTestId("admin-customer-blocked-badge")).toBeVisible({
      timeout: 10_000,
    });

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { isBlocked: true },
    });
    expect(reloaded.isBlocked).toBe(true);
  });

  test("(c) /admin/audit page рендерит recent admin events", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    // Сначала генерируем несколько событий разных групп.
    await page.request.patch(`/api/admin/customers/${target.id}/role`, {
      data: { role: "manager", reason: "Audit test promote" },
      headers: { "Content-Type": "application/json" },
    });
    await page.request.post(`/api/admin/customers/${target.id}/block`, {
      data: { reason: "Audit test block" },
      headers: { "Content-Type": "application/json" },
    });

    await page.goto("/ru/admin/audit");
    await expect(page.getByTestId("admin-audit")).toBeVisible();
    await expect(page.getByTestId("admin-audit-table")).toBeVisible();
    // Должны увидеть `user.role_change` и `user.blocked` записи.
    await expect(
      page.locator('tr[data-testid="admin-audit-row"][data-action="user.blocked"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('tr[data-testid="admin-audit-row"][data-action="user.role_change"]').first(),
    ).toBeVisible();
  });

  test("(c) /admin/audit filter по group=user", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/ru/admin/audit?group=user");
    await expect(page.getByTestId("admin-audit-group-filter")).toHaveValue("user");
    // Все видимые rows должны иметь action начинающийся с `user.`
    const actions = await page
      .locator('tr[data-testid="admin-audit-row"]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-action")));
    if (actions.length > 0) {
      expect(actions.every((a) => a?.startsWith("user."))).toBe(true);
    }
  });

  test("(d) Bulk role change happy: 2 customers → manager + skipped self-demote", async ({
    page,
  }) => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    // Создаём ещё одного customer для batch'а.
    const extra = await prisma.user.create({
      data: {
        email: "e2e-extra-bulk@bigmax.uz",
        passwordHash: await hash("pass1234567890", 10),
        name: "Extra Bulk",
        role: "customer",
        language: "ru",
      },
      select: { id: true },
    });

    try {
      await loginAsAdmin(page);
      const res = await page.request.post("/api/admin/customers/bulk-role", {
        data: {
          userIds: [target.id, extra.id, adminUser.id],
          role: "customer",
          reason: "Bulk role test",
        },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        processed: string[];
        skipped: Array<{ userId: string; reason: string }>;
      };
      // adminUser сам себя — cannot_self_demote → skipped
      // target и extra уже customer → role_unchanged → skipped (либо processed=0)
      // Но поскольку target = customer и переходит в customer → role_unchanged.
      // Меняю на manager:
      const res2 = await page.request.post("/api/admin/customers/bulk-role", {
        data: {
          userIds: [target.id, extra.id, adminUser.id],
          role: "manager",
          reason: "Bulk promote",
        },
        headers: { "Content-Type": "application/json" },
      });
      expect(res2.status()).toBe(200);
      const body2 = (await res2.json()) as {
        processed: string[];
        skipped: Array<{ userId: string; reason: string }>;
      };
      expect(body2.processed).toHaveLength(2);
      expect(body2.skipped).toHaveLength(1);
      expect(body2.skipped[0]?.userId).toBe(adminUser.id);
      expect(body2.skipped[0]?.reason).toBe("cannot_self_demote");

      const reloaded = await prisma.user.findMany({
        where: { id: { in: [target.id, extra.id] } },
        select: { role: true },
      });
      expect(reloaded.every((u) => u.role === "manager")).toBe(true);

      void body;
    } finally {
      await prisma.paymentLog
        .deleteMany({
          where: {
            action: "user.role_change",
            request: { path: ["targetUserId"], equals: extra.id },
          },
        })
        .catch(() => {});
      await prisma.user.delete({ where: { id: extra.id } }).catch(() => {});
    }
  });

  test("(d) Bulk role: empty userIds → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/customers/bulk-role", {
      data: { userIds: [], role: "manager", reason: "ok ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("(d) Bulk role: > 50 userIds → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const res = await page.request.post("/api/admin/customers/bulk-role", {
      data: { userIds: ids, role: "manager", reason: "ok ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("(d) Bulk role anon → 401", async ({ request }) => {
    const res = await request.post("/api/admin/customers/bulk-role", {
      data: { userIds: ["x"], role: "manager", reason: "ok ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
