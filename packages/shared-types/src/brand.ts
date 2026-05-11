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
  domain: "bigmax.uz",
  url: "https://bigmax.uz",
  email: "info@bigmax.uz",
  supportEmail: "support@bigmax.uz",
  ordersEmail: "orders@bigmax.uz",
  telegramChannel: "@bigmax_uz",
  telegramBot: "@bigmax_shop_bot",
  instagram: "@bigmax.uz",
  phoneTemplate: "+998 XX XXX XX XX",
  smsSender: "BIGMAX",
  currency: "UZS",
  orderNumberPrefix: "BGX",
} as const;

export type Brand = typeof BRAND;
