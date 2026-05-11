import { describe, expect, it } from "vitest";

import {
  buildOrderCreatedEmail,
  buildOrderCreatedSms,
  buildOrderCreatedTelegram,
  type OrderCreatedPayload,
} from "./created";

const PAYLOAD: OrderCreatedPayload = {
  orderNumber: "BGX-20260427-0001",
  totalCents: 25_000_00, // 25 000 сум
  url: "https://bigmax.uz/ru/orders/abc123/success",
};

describe("buildOrderCreatedSms · все локали", () => {
  it("ru — содержит номер, отформатированную сумму, url", async () => {
    const sms = await buildOrderCreatedSms("ru", PAYLOAD);
    expect(sms).toContain("Бигмах");
    expect(sms).toContain("BGX-20260427-0001");
    // ICU-форматтер ставит NBSP/NNBSP между триадами — match по \s.
    expect(sms).toMatch(/25\s000/);
    expect(sms).toContain(PAYLOAD.url);
  });

  it("uz — узбекский текст", async () => {
    const sms = await buildOrderCreatedSms("uz", PAYLOAD);
    expect(sms).toContain("Bigmax");
    expect(sms).toContain("BGX-20260427-0001");
    expect(sms).toContain("buyurtma");
  });

  it("en — английский текст", async () => {
    const sms = await buildOrderCreatedSms("en", PAYLOAD);
    expect(sms).toContain("Bigmax");
    expect(sms).toContain("order");
    expect(sms).toContain("BGX-20260427-0001");
  });

  it("неизвестная локаль fallback на ru (DEFAULT_LOCALE)", async () => {
    const sms = await buildOrderCreatedSms("kk-KZ", PAYLOAD);
    expect(sms).toContain("Бигмах");
  });

  it("формат суммы с локаль-специфичными разделителями (en — запятая)", async () => {
    const sms = await buildOrderCreatedSms("en", { ...PAYLOAD, totalCents: 1_500_000_00 });
    // 1 500 000 в RU, 1,500,000 в EN
    // EN locale использует comma — `Intl.NumberFormat` гарантирует это.
    expect(sms).toMatch(/1,500,000/);
  });
});

describe("buildOrderCreatedTelegram · структура", () => {
  it("возвращает {title, body} раздельно для будущих markdown-форматирований", async () => {
    const tpl = await buildOrderCreatedTelegram("ru", PAYLOAD);
    expect(tpl.title).toMatch(/Спасибо за заказ/);
    expect(tpl.body).toContain("BGX-20260427-0001");
    expect(tpl.body).toMatch(/25\s000/);
    expect(tpl.body).toContain(PAYLOAD.url);
  });

  it("body содержит \\n-разделители (multiline)", async () => {
    const tpl = await buildOrderCreatedTelegram("ru", PAYLOAD);
    expect(tpl.body.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildOrderCreatedEmail · subject/text/html", () => {
  it("subject + plain text + HTML body все заполнены", async () => {
    const tpl = await buildOrderCreatedEmail("ru", PAYLOAD);
    expect(tpl.subject).toContain("Бигмах");
    expect(tpl.subject).toContain("BGX-20260427-0001");
    expect(tpl.text).toContain(PAYLOAD.url);
    expect(tpl.html).toContain("<!doctype html>");
    expect(tpl.html).toContain(PAYLOAD.url);
  });

  it("HTML экранирует XSS в orderNumber", async () => {
    const tpl = await buildOrderCreatedEmail("ru", {
      ...PAYLOAD,
      orderNumber: `BGX-<script>alert(1)</script>`,
    });
    expect(tpl.html).not.toContain("<script>alert(1)</script>");
    expect(tpl.html).toContain("&lt;script&gt;");
  });

  it("HTML экранирует & в url (query string)", async () => {
    const tpl = await buildOrderCreatedEmail("ru", {
      ...PAYLOAD,
      url: "https://bigmax.uz/ru?a=1&b=2",
    });
    expect(tpl.html).toContain("a=1&amp;b=2");
  });

  it("HTML содержит lang атрибут с локалью", async () => {
    const tpl = await buildOrderCreatedEmail("uz", PAYLOAD);
    expect(tpl.html).toContain('lang="uz"');
  });
});
