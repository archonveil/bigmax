/**
 * P3-T6: sync guest→user при логине.
 *
 * Гостевые favorites живут в `bigmax:favorites`. При появлении auth-сессии
 * `<FavoritesSync>` (mount-once в root layout) делает:
 *   1. GET /api/auth/session → user.id.
 *   2. POST /api/favorites/sync {productIds} → merge на сервере.
 *   3. setItems(serverResponse) → локальный state заменяется merged-списком.
 *
 * Сценарий теста:
 *   - создаём test-юзера через Prisma;
 *   - гость добавляет featured товар в favorites;
 *   - логинимся этим юзером;
 *   - после post-login `<FavoritesSync>` должен отработать;
 *   - на /favorites товар всё ещё виден (persisted на сервер).
 *
 * Cleanup Favorite-записей — через Prisma deleteMany по userId в afterEach.
 */

import { prisma } from "@bigmax/db";
import { expect, test } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-fav-sync@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Fav Sync",
};

test.beforeEach(async () => {
  await createTestUser(USER);
  // На всякий случай чистим прошлые Favorite-записи юзера.
  await prisma.favorite.deleteMany({ where: { user: { email: USER.email } } });
});

test.afterEach(async () => {
  await prisma.favorite.deleteMany({ where: { user: { email: USER.email } } });
  await deleteTestUser(USER.email);
});

test("guest→user sync: гостевые favorites появляются в серверной БД после логина", async ({
  page,
}) => {
  // 1. Гость добавляет первый featured товар в favorites.
  await page.goto("/ru");
  await page.evaluate(() => localStorage.removeItem("bigmax:favorites"));
  await page.locator("article").first().getByRole("button", { name: "В избранное" }).click();

  const favBtn = page.getByRole("link", { name: "Открыть избранное" }).first();
  await expect(favBtn.locator("span[aria-hidden]")).toHaveText("1");

  // 2. Логинимся (email+password).
  await page.goto("/ru/auth/login");
  await page.locator("input#email").fill(USER.email);
  await page.locator("input#password").fill(USER.password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await expect(page).toHaveURL(/\/ru$/);

  // 3. Ждём rehydrate + sync-fetch (FavoritesSync в root layout).
  //    На /favorites должен остаться тот же товар.
  await page.goto("/ru/favorites");
  await expect(page.getByText(/Mock-товар/)).toBeVisible({ timeout: 5_000 });

  // 4. Проверяем что Favorite-запись действительно создалась в БД.
  const dbFavs = await prisma.favorite.findMany({
    where: { user: { email: USER.email } },
    select: { productId: true },
  });
  expect(dbFavs.length).toBeGreaterThanOrEqual(1);
});
