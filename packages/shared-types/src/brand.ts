/**
 * Константы бренда "Бигмах" (bigmax.uz).
 *
 * Единственный источник правды для названия, домена, контактных email'ов,
 * соц.сетей и валюты. Импортируется везде, где в UI или уведомлениях нужно
 * имя/адрес магазина.
 */

export const BRAND = {
  nameRu: "Бигмах",
  nameLatin: "Bigmax",
  domain: "domtextile.uz",
  url: "https://domtextile.uz",
  email: "domtextil.uz@gmail.com",
  supportEmail: "domtextil.uz@gmail.com",
  ordersEmail: "domtextil.uz@gmail.com",
  telegramChannel: "@bigmax_uz",
  telegramBot: "@bigmax_shop_bot",
  instagram: "@bigmax.uz",
  phone1: "+998200095110",
  phone2: "+998200341888",
  phoneTemplate: "+998 20 009-51-10",
  smsSender: "BIGMAX",
  currency: "UZS",
  orderNumberPrefix: "BGX",
} as const;

export type Brand = typeof BRAND;
