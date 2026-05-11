/**
 * P6-T4 follow-up: e2e для tree-view + bulk-actions + reorder.
 */

import { prisma } from "@bigmax/db";
import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const ADMIN = {
  email: "e2e-cat-tree@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Cat Tree",
  role: "admin" as const,
};
const PREFIX = "e2e-cat-fu";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(ADMIN.email);
  await page.locator("input#password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
}

async function cleanup(): Promise<void> {
  // Удаляем дочерние сначала (parentId references), затем родителей.
  await prisma.category.deleteMany({
    where: { slug: { startsWith: PREFIX }, parentId: { not: null } },
  });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

test.describe("P6-T4 follow-up · category tree + bulk + reorder", () => {
  test.beforeEach(async () => {
    await createTestUser(ADMIN);
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
    await deleteTestUser(ADMIN.email).catch(() => {});
  });

  test("tree: parent + child рендерятся с правильным data-depth", async ({ page }) => {
    const parent = await prisma.category.create({
      data: {
        slug: `${PREFIX}-tree-parent`,
        nameRu: "Родитель T",
        nameUz: "Roditel",
        nameEn: "Parent",
        order: 1000,
      },
      select: { id: true },
    });
    const child = await prisma.category.create({
      data: {
        slug: `${PREFIX}-tree-child`,
        nameRu: "Дочерняя T",
        nameUz: "Bola",
        nameEn: "Child",
        parentId: parent.id,
        order: 1001,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    await page.goto("/ru/admin/categories");
    const parentRow = page.locator(`tr[data-id="${parent.id}"]`);
    const childRow = page.locator(`tr[data-id="${child.id}"]`);
    await expect(parentRow).toHaveAttribute("data-depth", "0");
    await expect(childRow).toHaveAttribute("data-depth", "1");
  });

  test("bulk-deactivate: select 2 категории → API → updated=2 + isActive=false в БД", async ({
    page,
  }) => {
    const c1 = await prisma.category.create({
      data: {
        slug: `${PREFIX}-bulk-1`,
        nameRu: "Bulk 1",
        nameUz: "Bulk 1",
        nameEn: "Bulk 1",
        isActive: true,
      },
      select: { id: true },
    });
    const c2 = await prisma.category.create({
      data: {
        slug: `${PREFIX}-bulk-2`,
        nameRu: "Bulk 2",
        nameUz: "Bulk 2",
        nameEn: "Bulk 2",
        isActive: true,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/bulk", {
      data: { ids: [c1.id, c2.id], action: "deactivate" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(2);
    const reloaded = await prisma.category.findMany({
      where: { id: { in: [c1.id, c2.id] } },
      select: { isActive: true },
    });
    expect(reloaded.every((r) => r.isActive === false)).toBe(true);
  });

  test("bulk: пустой ids → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/bulk", {
      data: { ids: [], action: "deactivate" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("bulk: неизвестный action → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/bulk", {
      data: { ids: ["some_id"], action: "delete" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("bulk-activate: исходно false → updated=1 + isActive=true", async ({ page }) => {
    const c1 = await prisma.category.create({
      data: {
        slug: `${PREFIX}-bulk-act-1`,
        nameRu: "BA 1",
        nameUz: "BA 1",
        nameEn: "BA 1",
        isActive: false,
      },
      select: { id: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/bulk", {
      data: { ids: [c1.id], action: "activate" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const reloaded = await prisma.category.findUniqueOrThrow({
      where: { id: c1.id },
      select: { isActive: true },
    });
    expect(reloaded.isActive).toBe(true);
  });

  test("reorder: POST с новым order → БД обновлена", async ({ page }) => {
    const a = await prisma.category.create({
      data: {
        slug: `${PREFIX}-ord-a`,
        nameRu: "A",
        nameUz: "A",
        nameEn: "A",
        order: 100,
      },
      select: { id: true },
    });
    const b = await prisma.category.create({
      data: {
        slug: `${PREFIX}-ord-b`,
        nameRu: "B",
        nameUz: "B",
        nameEn: "B",
        order: 101,
      },
      select: { id: true },
    });

    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/reorder", {
      data: {
        items: [
          { id: b.id, order: 100 },
          { id: a.id, order: 101 },
        ],
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    const updated = await prisma.category.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, order: true },
    });
    const aRow = updated.find((u) => u.id === a.id);
    const bRow = updated.find((u) => u.id === b.id);
    expect(aRow?.order).toBe(101);
    expect(bRow?.order).toBe(100);
  });

  test("reorder: не существующий id → 404 + tx rollback", async ({ page }) => {
    const a = await prisma.category.create({
      data: {
        slug: `${PREFIX}-rb-a`,
        nameRu: "A",
        nameUz: "A",
        nameEn: "A",
        order: 50,
      },
      select: { id: true, order: true },
    });
    await loginAsAdmin(page);
    const res = await page.request.post("/api/admin/categories/reorder", {
      data: {
        items: [
          { id: a.id, order: 999 },
          { id: "cuid_doesnt_exist", order: 1000 },
        ],
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
    // Tx откатился — order у `a` не изменился.
    const reloaded = await prisma.category.findUniqueOrThrow({
      where: { id: a.id },
      select: { order: true },
    });
    expect(reloaded.order).toBe(50);
  });

  test("UI smoke: bulk-bar появляется при выборе строки", async ({ page }) => {
    await prisma.category.create({
      data: {
        slug: `${PREFIX}-ui-1`,
        nameRu: "UI 1",
        nameUz: "UI 1",
        nameEn: "UI 1",
        order: 5000,
      },
    });
    await loginAsAdmin(page);
    await page.goto("/ru/admin/categories");
    await expect(page.getByTestId("admin-categories-tree")).toBeVisible();
    // Bulk-bar пока невидим (selected.size === 0).
    await expect(page.getByTestId("admin-categories-bulk-bar")).toHaveCount(0);
    // Кликаем checkbox первой видимой строки нашего prefix.
    const row = page.locator(`tr`).filter({ hasText: "UI 1" }).first();
    await row.getByTestId("row-checkbox").check();
    await expect(page.getByTestId("admin-categories-bulk-bar")).toBeVisible();
    await expect(page.getByTestId("admin-categories-bulk-bar")).toContainText(/выбран/i);
  });

  test("anon → 401 на bulk и reorder", async ({ request }) => {
    for (const path of ["/api/admin/categories/bulk", "/api/admin/categories/reorder"]) {
      const res = await request.post(path, {
        data: {},
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(401);
    }
  });
});
