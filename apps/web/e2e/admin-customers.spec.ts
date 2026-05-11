/**
 * P6-T8: e2e для admin customers — list/filter/role-change/reset-password + auth.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";
import { compare } from "bcryptjs";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-admin-customers@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Admin Customers",
  role: "admin" as const,
};

const TARGET = {
  email: "e2e-target-customer@bigmax.uz",
  password: "originalPass1234",
  name: "E2E Target Customer",
  role: "customer" as const,
};

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

test.describe("P6-T8 · admin customers", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await createTestUser(TARGET);
  });

  test.afterEach(async () => {
    await deleteTestUser(TARGET.email).catch(() => {});
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("anon → PATCH /api/admin/customers/x/role → 401", async ({ request }) => {
    const res = await request.patch("/api/admin/customers/some_id/role", {
      data: { role: "manager", reason: "test ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("anon → POST /api/admin/customers/x/reset-password → 401", async ({ request }) => {
    const res = await request.post("/api/admin/customers/some_id/reset-password", {
      data: { reason: "test ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("customer → PATCH role → 404 (silent)", async ({ page }) => {
    const customer = {
      email: "e2e-customers-customer@bigmax.uz",
      password: "e2ePass1234",
      name: "C",
    };
    await createTestUser(customer);
    try {
      await page.goto("/ru/auth/login");
      await page.locator("input#email").fill(customer.email);
      await page.locator("input#password").fill(customer.password);
      await page.getByRole("button", { name: /^Войти$/ }).click();
      await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
      const res = await page.request.patch("/api/admin/customers/some_id/role", {
        data: { role: "manager", reason: "test ok" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(404);
    } finally {
      await deleteTestUser(customer.email).catch(() => {});
    }
  });

  test("list page → видит target + filter по role=customer", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/customers?role=customer");
    await expect(page.getByTestId("admin-customers")).toBeVisible();
    const row = page.locator(`tr[data-user-id="${target.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(TARGET.email);
  });

  test("filter q по email", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/customers?q=${encodeURIComponent(TARGET.email)}`);
    await expect(page.locator(`tr[data-user-id="${target.id}"]`)).toBeVisible();
  });

  test("PATCH role: customer → manager + PaymentLog audit", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.patch(`/api/admin/customers/${target.id}/role`, {
      data: { role: "manager", reason: "Promote to manager (test)" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { role: true },
    });
    expect(reloaded.role).toBe("manager");

    const log = await prisma.paymentLog.findFirst({
      where: {
        action: "user.role_change",
        request: { path: ["targetUserId"], equals: target.id },
      },
      select: { id: true },
    });
    expect(log).not.toBeNull();
  });

  test("PATCH role: cannot_self_demote → 409", async ({ page }) => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.patch(`/api/admin/customers/${adminUser.id}/role`, {
      data: { role: "customer", reason: "self demote" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("cannot_self_demote");

    // Не изменилось.
    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: adminUser.id },
      select: { role: true },
    });
    expect(reloaded.role).toBe("admin");
  });

  test("PATCH role: role_unchanged → 409", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.patch(`/api/admin/customers/${target.id}/role`, {
      data: { role: "customer", reason: "no change" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("role_unchanged");
  });

  test("PATCH role: invalid_body (reason < 3) → 400", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.patch(`/api/admin/customers/${target.id}/role`, {
      data: { role: "manager", reason: "ab" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST reset-password: возвращает temp-pass + новый bcrypt-hash в БД", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true, passwordHash: true },
    });
    const oldHash = target.passwordHash;
    await loginAsAdmin(page);
    const res = await page.request.post(`/api/admin/customers/${target.id}/reset-password`, {
      data: { reason: "Customer forgot password" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { temporaryPassword: string };
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    // Не I/l/1/O/0
    expect(body.temporaryPassword).not.toMatch(/[Il1O0]/);

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { passwordHash: true },
    });
    expect(reloaded.passwordHash).not.toBe(oldHash);
    // Новый hash валидируется через bcrypt.
    expect(reloaded.passwordHash).not.toBeNull();
    const matches = await compare(body.temporaryPassword, reloaded.passwordHash!);
    expect(matches).toBe(true);
  });

  test("POST reset-password: OTP-only user → 409 user_has_no_password", async ({ page }) => {
    // Создаём OTP-only клиента (без password hash'а).
    const otpUser = await prisma.user.create({
      data: {
        email: "e2e-otp-only@bigmax.uz",
        name: "OTP Only",
        phone: "+998901234567",
        role: "customer",
        language: "ru",
        // Без passwordHash.
      },
      select: { id: true },
    });
    try {
      await loginAsAdmin(page);
      const res = await page.request.post(`/api/admin/customers/${otpUser.id}/reset-password`, {
        data: { reason: "Try reset" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(409);
      const body = (await res.json()) as { reason: string };
      expect(body.reason).toBe("user_has_no_password");
    } finally {
      await prisma.user.delete({ where: { id: otpUser.id } }).catch(() => {});
    }
  });

  test("POST reset-password: non-existent user → 404", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/customers/cuid_doesnt_exist/reset-password", {
      data: { reason: "ok ok ok" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("UI smoke: detail page → role-changer + reset-password trigger видны", async ({ page }) => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/customers/${target.id}`);
    await expect(page.getByTestId("admin-customer-detail")).toBeVisible();
    await expect(page.getByTestId("customer-role-changer")).toBeVisible();
    await expect(page.getByTestId("customer-reset-password-trigger")).toBeVisible();
  });

  test("UI: смотрим самого себя → role-changer заблокирован", async ({ page }) => {
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    await loginAsAdmin(page);
    await page.goto(`/ru/admin/customers/${adminUser.id}`);
    await expect(page.getByTestId("customer-role-blocked")).toBeVisible();
  });
});
