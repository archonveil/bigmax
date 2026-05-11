/**
 * P6-T8 follow-up (b): e2e для self-service password reset.
 *
 * Email-отправка mock'нута через `setResendClientForTesting` или просто
 * не тестируется напрямую — мы проверяем БД-эффекты + flow login'а с
 * новым паролем.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";
import { compare } from "bcryptjs";

import { createTestUser, deleteTestUser } from "./helpers/user";

const TARGET = {
  email: "e2e-pwd-reset@bigmax.uz",
  password: "originalPass1234",
  name: "E2E Pwd Reset",
  role: "customer" as const,
};

async function generateResetTokenForUser(email: string): Promise<string> {
  // Шорткат: вызываем API напрямую, потом достаём out-of-band token из БД.
  // В e2e это imitates email click flow: token попадает в URL и/или
  // copy-paste через support, минуя email canal который не работает в CI.
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  // Удаляем старые tokens чтобы не путаться.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  // Импортим helper из server — но e2e не может его require. Поэтому
  // дёргаем API request endpoint и затем читаем БД. URL с plain-token не
  // приходит в response, поэтому используем in-place generate (через
  // server-helper):
  const { createResetToken } = await import("../src/server/password-reset");
  return createResetToken(user.id);
}

async function loginWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(email);
  await page.locator("input#password").fill(password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
}

test.describe("P6-T8 follow-up (b) · self-service password reset", () => {
  test.beforeEach(async () => {
    await createTestUser(TARGET);
  });

  test.afterEach(async () => {
    await deleteTestUser(TARGET.email).catch(() => {});
  });

  test("request endpoint: known email → 200 + token created in DB", async ({ request }) => {
    const res = await request.post("/api/auth/password-reset/request", {
      data: { email: TARGET.email },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    // Token должен быть создан.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { id: true },
    });
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id, usedAt: null },
      select: { id: true, expiresAt: true },
    });
    expect(tokens).toHaveLength(1);
    // expiresAt ≈ now + 30 min.
    const diffMin = (tokens[0]!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(diffMin).toBeGreaterThan(28);
    expect(diffMin).toBeLessThan(31);
  });

  test("request endpoint: unknown email → 200 (tactical silence)", async ({ request }) => {
    const res = await request.post("/api/auth/password-reset/request", {
      data: { email: "definitely-not-a-user@nowhere.invalid" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    // Nothing in DB for unknown email.
    const tokens = await prisma.passwordResetToken.findMany({
      where: { user: { email: "definitely-not-a-user@nowhere.invalid" } },
    });
    expect(tokens).toHaveLength(0);
  });

  test("request endpoint: invalid email format → 400", async ({ request }) => {
    const res = await request.post("/api/auth/password-reset/request", {
      data: { email: "not-an-email" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("complete endpoint: happy path → password updated + token used", async ({ request }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    const newPassword = "MyNewSecurePass2026";

    const res = await request.post("/api/auth/password-reset/complete", {
      data: { token, password: newPassword },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);

    // Password обновился — bcrypt-compare с новым.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: TARGET.email },
      select: { passwordHash: true },
    });
    expect(user.passwordHash).not.toBeNull();
    expect(await compare(newPassword, user.passwordHash!)).toBe(true);
    // Старый password больше не работает.
    expect(await compare(TARGET.password, user.passwordHash!)).toBe(false);

    // Token помечен usedAt.
    const tokenRow = await prisma.passwordResetToken.findFirstOrThrow({
      where: { user: { email: TARGET.email } },
      select: { usedAt: true },
    });
    expect(tokenRow.usedAt).not.toBeNull();
  });

  test("complete endpoint: token replay → 400 tokenAlreadyUsed", async ({ request }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    await request.post("/api/auth/password-reset/complete", {
      data: { token, password: "FirstPass1234" },
      headers: { "Content-Type": "application/json" },
    });
    // Второй раз тем же token'ом.
    const res = await request.post("/api/auth/password-reset/complete", {
      data: { token, password: "SecondPass1234" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("tokenAlreadyUsed");
  });

  test("complete endpoint: invalid token → 400 tokenInvalid", async ({ request }) => {
    const res = await request.post("/api/auth/password-reset/complete", {
      data: { token: "fakeid.fakehash", password: "ValidPass1234" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("tokenInvalid");
  });

  test("complete endpoint: expired token → 400 tokenExpired", async ({ request }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    // Manual-expire через UPDATE.
    await prisma.passwordResetToken.updateMany({
      where: { user: { email: TARGET.email } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await request.post("/api/auth/password-reset/complete", {
      data: { token, password: "ValidPass1234" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).reason).toBe("tokenExpired");
  });

  test("complete endpoint: short password → 400", async ({ request }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    const res = await request.post("/api/auth/password-reset/complete", {
      data: { token, password: "short" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("после reset'а можно залогиниться с новым password'ом", async ({ page, request }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    const newPassword = "BrandNewPass2026";
    await request.post("/api/auth/password-reset/complete", {
      data: { token, password: newPassword },
      headers: { "Content-Type": "application/json" },
    });

    await loginWith(page, TARGET.email, newPassword);
    await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
    expect(page.url()).not.toContain("/auth/login");
  });

  test("UI smoke: request page → submit → success-message", async ({ page }) => {
    await page.goto("/ru/auth/password-reset");
    await expect(page.getByTestId("password-reset-request-form")).toBeVisible();
    await page.getByTestId("password-reset-email-input").fill(TARGET.email);
    await page.getByTestId("password-reset-submit").click();
    await expect(page.getByTestId("password-reset-request-success")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("UI smoke: complete page → submit → success-message", async ({ page }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    await page.goto(`/ru/auth/password-reset/${token}`);
    await expect(page.getByTestId("password-reset-complete-form")).toBeVisible();
    await page.getByTestId("password-reset-password-input").fill("UICompleteTest1234");
    await page.getByTestId("password-reset-confirm-input").fill("UICompleteTest1234");
    await page.getByTestId("password-reset-complete-submit").click();
    await expect(page.getByTestId("password-reset-complete-success")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("UI: password mismatch → inline error без call'а", async ({ page }) => {
    const token = await generateResetTokenForUser(TARGET.email);
    await page.goto(`/ru/auth/password-reset/${token}`);
    await page.getByTestId("password-reset-password-input").fill("First1234567");
    await page.getByTestId("password-reset-confirm-input").fill("Different1234");
    await page.getByTestId("password-reset-complete-submit").click();
    await expect(page.getByTestId("password-reset-complete-error")).toBeVisible();
  });

  test("Login page: 'Забыли пароль' link ведёт на /auth/password-reset", async ({ page }) => {
    await page.goto("/ru/auth/login");
    await expect(page.getByTestId("login-forgot-password")).toBeVisible();
    await page.getByTestId("login-forgot-password").click();
    await page.waitForURL((url) => url.pathname.includes("/auth/password-reset"), {
      timeout: 10_000,
    });
    expect(page.url()).toContain("/auth/password-reset");
  });
});
