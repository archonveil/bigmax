/**
 * P4-T5: `POST /api/checkout/pay` — happy path и отказы.
 *
 * Покрываем:
 *   1. Гость пытается POST → 401.
 *   2. Залогиненный юзер нажимает «Оформить заказ» → сервер возвращает
 *      HTML self-submit формы; браузер пытается POST на
 *      `https://wpay.uniteller.ru/pay/` — перехватываем, проверяем что форма
 *      содержит все обязательные поля + Signature в правильном формате.
 *   3. POST с COD → 501.
 */

import { expect, test, type Page } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/user";

const USER = {
  email: "e2e-checkout-pay@bigmax.uz",
  password: "e2ePass1234",
  name: "E2E Pay",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/ru");
  await page.evaluate(() => {
    localStorage.removeItem("bigmax:cart");
    localStorage.removeItem("bigmax:checkout-draft");
  });
});

test("POST /api/checkout/pay без session → 401", async ({ request }) => {
  const res = await request.post("/api/checkout/pay", {
    data: { foo: "bar" },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(401);
  const body = (await res.json()) as { ok: boolean; reason: string };
  expect(body).toMatchObject({ ok: false, reason: "unauthorized" });
});

test.describe("authenticated happy path", () => {
  test.beforeEach(async ({ page }) => {
    await createTestUser(USER);
    await page.goto("/ru/auth/login");
    await page.locator("input#email").fill(USER.email);
    await page.locator("input#password").fill(USER.password);
    await page.getByRole("button", { name: /^Войти$/ }).click();
    await page.waitForURL((url) => !url.pathname.includes("/auth/"), { timeout: 10_000 });
  });

  test.afterEach(async () => {
    await deleteTestUser(USER.email);
  });

  test("клик «Оформить заказ» → POST на wpay.uniteller.ru с корректной формой", async ({
    page,
  }) => {
    await fillCheckoutToReview(page);

    // Перехватываем исходящий POST на Uniteller до того, как браузер уйдёт с
    // нашего домена. `abort()` оставит нас на той же странице (с replaced DOM).
    const capture = new Promise<Record<string, string>>((resolve) => {
      void page.route("https://wpay.uniteller.ru/pay/**", (route) => {
        const postData = route.request().postData() ?? "";
        const fields: Record<string, string> = {};
        for (const pair of postData.split("&")) {
          const [k, v] = pair.split("=");
          if (k) fields[decodeURIComponent(k)] = decodeURIComponent((v ?? "").replace(/\+/g, " "));
        }
        resolve(fields);
        void route.abort();
      });
    });

    await page.getByRole("button", { name: /Оформить заказ/ }).click();

    const fields = await capture;

    // Все обязательные поля §5.4 присутствуют
    expect(fields["Shop_IDP"]).toBe("BGX_TEST_SHOP");
    expect(fields["Order_IDP"]).toMatch(/^BGX-\d{8}-\d{4}$/);
    expect(fields["Subtotal_P"]).toMatch(/^\d+\.\d{2}$/);
    expect(fields["Signature"]).toMatch(/^[A-F0-9]{32}$/);
    expect(fields["URL_RETURN_OK"]).toMatch(/^http:\/\/localhost:3030\/ru\/orders\/.+\/success$/);
    expect(fields["URL_RETURN_NO"]).toMatch(/^http:\/\/localhost:3030\/ru\/orders\/.+\/failure$/);
    expect(fields["URL_RETURN"]).toMatch(/^http:\/\/localhost:3030\/ru\/orders\/.+\/return$/);
    expect(fields["Email"]).toBe("ivan@example.com");
    expect(fields["Phone"]).toBe("+998901234567");
    expect(fields["Language"]).toBe("ru");
    expect(fields["Lifetime"]).toBe("30");
  });

  test("COD ветка → 200 JSON c redirectTo + Order/Payment созданы (P4-T8)", async ({ page }) => {
    // Чтобы Zod пропустил, нужен реальный variantId — берём seed-pacifier.
    await page.goto("/ru/product/nuby-cherry-pacifier");
    const variantSelect = page
      .locator('[data-testid="variant-picker"]')
      .or(page.locator("article").first());
    void variantSelect; // Просто гарантируем что страница загрузилась.

    // Получаем variantId из БД через Prisma — самый надёжный путь.
    const { prisma } = await import("@bigmax/db");
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { sku: "NB-PAC-PK" },
      select: { id: true },
    });

    const body = {
      contacts: { name: "Иван Иванов", email: "ivan@example.com", phone: "+998901234567" },
      address: {
        region: "andijan",
        city: "Андижан",
        district: "",
        street: "ул.",
        house: "1",
        apartment: "",
        landmark: "",
        phone: "",
      },
      delivery: { method: "courier", branchId: "", comment: "" },
      payment: { method: "cod" },
      items: [{ variantId: variant.id, quantity: 1 }],
      locale: "ru",
    };
    const res = await page.request.post("/api/checkout/pay", {
      data: body,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");

    const json = (await res.json()) as {
      ok: boolean;
      provider: string;
      orderId: string;
      orderNumber: string;
      redirectTo: string;
    };
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("cod");
    expect(json.orderNumber).toMatch(/^BGX-\d{8}-\d{4}$/);
    expect(json.redirectTo).toBe(`/ru/orders/${json.orderId}/success`);

    // Order + Payment в БД с правильными атрибутами.
    const order = await prisma.order.findUnique({
      where: { id: json.orderId },
      include: { payments: true },
    });
    expect(order).not.toBeNull();
    expect(order!.status).toBe("pending");
    expect(order!.payments).toHaveLength(1);
    expect(order!.payments[0]!.provider).toBe("cod");
    expect(order!.payments[0]!.status).toBe("pending");
    expect(order!.payments[0]!.unitellerOrderIdp).toBeNull();
  });
});

async function fillCheckoutToReview(page: Page): Promise<void> {
  await page.goto("/ru/product/nuby-cherry-pacifier");
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto("/ru/checkout");

  await page.getByLabel("Имя", { exact: true }).fill("Иван Иванов");
  await page.getByLabel("Email", { exact: true }).fill("ivan@example.com");
  await page.getByLabel("Телефон", { exact: true }).fill("+998901234567");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByLabel("Регион").click();
  await page.getByRole("option", { name: "Андижан", exact: true }).click();
  await page.getByLabel("Город").fill("Андижан");
  await page.getByLabel("Улица").fill("Амира Темура");
  await page.getByLabel("Дом").fill("1");
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await page.getByRole("button", { name: /^Далее$/ }).click(); // delivery (courier default)
  await page.getByRole("button", { name: /^Далее$/ }).click(); // payment (uniteller default)

  await expect(page.getByRole("heading", { name: "Проверьте заказ" })).toBeVisible();
}
