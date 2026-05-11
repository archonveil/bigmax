/**
 * P6-T5: PDF-накладная через `@react-pdf/renderer`.
 *
 * Генерирует одностраничный документ A4 с логотипом Bigmax (текстовым,
 * без SVG-зависимостей чтобы избежать font-loading в server-runtime),
 * шапкой заказа, реквизитами клиента, табличкой items, итоговыми суммами.
 *
 * **Шрифт:** Roboto (Apache 2.0) — встроенная Helvetica поддерживает
 * только Latin-1, а у нас в content есть кириллица (товары/адреса/имена)
 * и латиница UZ-letter ʻ. Roboto-Regular + Roboto-Bold загружаются из
 * `apps/web/public/fonts/` через absolute fs-path при cold-start
 * (process.cwd() → стабилен в Next runtime). Без этого fix'а в Acrobat /
 * Chrome PDF viewer'ах кириллица показывалась бы как `■■■` или вообще
 * пустота — закрывает open question P6-T5.b.
 *
 * **Локализация:** PDF рендерится на языке заказа (`Order.locale`) — у
 * каждого Order'а в БД хранится locale из чекаута, поэтому накладная
 * клиента всегда на «его» языке. Static labels — в `LABELS` ниже,
 * 3 локали × 30 ключей. Для расширения — добавить ключ + перевод.
 * Closes P6-T5.a.
 */

import path from "node:path";

import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";

import type { AdminOrderDetail } from "./admin-orders";

// ---------------------------------------------------------------------------
// Шрифт
// ---------------------------------------------------------------------------

const FONTS_DIR = path.join(process.cwd(), "public", "fonts");

let fontsRegistered = false;
function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  Font.register({
    family: "Roboto",
    fonts: [
      { src: path.join(FONTS_DIR, "Roboto-Regular.ttf") },
      { src: path.join(FONTS_DIR, "Roboto-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Roboto не имеет hyphenation-callback'а в @react-pdf, отключаем чтобы
  // не было `Did you forget to register a hyphenation callback?` warning'ов.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

// ---------------------------------------------------------------------------
// Локализация
// ---------------------------------------------------------------------------

type Locale = "ru" | "uz" | "en";

const LABELS: Record<Locale, Record<string, string>> = {
  ru: {
    title: "Накладная",
    no: "№",
    from: "от",
    statusLabel: "Статус",
    purchaser: "Покупатель",
    name: "Имя",
    email: "Email",
    phone: "Телефон",
    delivery: "Доставка",
    method: "Способ",
    courier: "Курьер",
    pickup: "Самовывоз",
    address: "Адрес",
    branch: "Филиал",
    apartment: "кв.",
    items: "Состав заказа",
    itemName: "Наименование",
    qty: "Кол-во",
    price: "Цена",
    sum: "Сумма",
    productFallback: "Товар",
    subtotal: "Подытог",
    deliveryRow: "Доставка",
    discount: "Скидка",
    total: "Итого",
    comment: "Комментарий",
    statusPending: "Ожидает оплаты",
    statusConfirmed: "Подтверждён",
    statusPacking: "Сборка",
    statusShipped: "Отправлен",
    statusDelivered: "Доставлен",
    statusCancelled: "Отменён",
    statusRefunded: "Возврат",
    pageCounter: "стр.",
    locale: "ru-RU",
  },
  uz: {
    title: "Hujjat",
    no: "№",
    from: "sana",
    statusLabel: "Status",
    purchaser: "Xaridor",
    name: "Ism",
    email: "Email",
    phone: "Telefon",
    delivery: "Yetkazib berish",
    method: "Usul",
    courier: "Kuryer",
    pickup: "Olib ketish",
    address: "Manzil",
    branch: "Filial",
    apartment: "kv.",
    items: "Buyurtma tarkibi",
    itemName: "Nomi",
    qty: "Soni",
    price: "Narxi",
    sum: "Jami",
    productFallback: "Mahsulot",
    subtotal: "Subtotal",
    deliveryRow: "Yetkazib berish",
    discount: "Chegirma",
    total: "Jami",
    comment: "Izoh",
    statusPending: "To'lovni kutmoqda",
    statusConfirmed: "Tasdiqlangan",
    statusPacking: "Yig'ish",
    statusShipped: "Yuborilgan",
    statusDelivered: "Yetkazilgan",
    statusCancelled: "Bekor qilingan",
    statusRefunded: "Qaytarish",
    pageCounter: "bet",
    locale: "uz-UZ",
  },
  en: {
    title: "Invoice",
    no: "#",
    from: "of",
    statusLabel: "Status",
    purchaser: "Customer",
    name: "Name",
    email: "Email",
    phone: "Phone",
    delivery: "Delivery",
    method: "Method",
    courier: "Courier",
    pickup: "Pickup",
    address: "Address",
    branch: "Branch",
    apartment: "apt.",
    items: "Order items",
    itemName: "Name",
    qty: "Qty",
    price: "Price",
    sum: "Sum",
    productFallback: "Item",
    subtotal: "Subtotal",
    deliveryRow: "Delivery",
    discount: "Discount",
    total: "Total",
    comment: "Comment",
    statusPending: "Awaiting payment",
    statusConfirmed: "Confirmed",
    statusPacking: "Packing",
    statusShipped: "Shipped",
    statusDelivered: "Delivered",
    statusCancelled: "Cancelled",
    statusRefunded: "Refunded",
    pageCounter: "p.",
    locale: "en-US",
  },
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "statusPending",
  confirmed: "statusConfirmed",
  packing: "statusPacking",
  shipped: "statusShipped",
  delivered: "statusDelivered",
  cancelled: "statusCancelled",
  refunded: "statusRefunded",
};

function pickLocale(input: string): Locale {
  return input === "uz" || input === "en" ? input : "ru";
}

// ---------------------------------------------------------------------------
// Стили
// ---------------------------------------------------------------------------

const COLORS = {
  brand: "#0ea5e9",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  accent: "#0369a1",
} as const;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Roboto",
    fontSize: 10,
    color: COLORS.text,
    paddingTop: 32,
    paddingBottom: 32,
    paddingLeft: 36,
    paddingRight: 36,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  logoBox: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  logoText: {
    color: "#ffffff",
    fontFamily: "Roboto",
    fontWeight: "bold",
    fontSize: 22,
    letterSpacing: 2,
  },
  brandSub: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 4,
    textAlign: "center",
  },
  title: {
    fontSize: 18,
    fontFamily: "Roboto",
    fontWeight: "bold",
    marginBottom: 4,
  },
  meta: {
    color: COLORS.muted,
    fontSize: 10,
  },
  metaStrong: {
    color: COLORS.text,
    fontFamily: "Roboto",
    fontWeight: "bold",
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontFamily: "Roboto",
    fontWeight: "bold",
    fontSize: 11,
    color: COLORS.accent,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  twoCols: {
    flexDirection: "row",
    gap: 16,
  },
  col: {
    flex: 1,
  },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: 9,
  },
  fieldValue: {
    fontSize: 10,
    marginBottom: 4,
  },
  table: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: 6,
    paddingBottom: 6,
  },
  th: {
    fontFamily: "Roboto",
    fontWeight: "bold",
    fontSize: 10,
    color: COLORS.muted,
  },
  td: {
    fontSize: 10,
  },
  cName: { flex: 4 },
  cQty: { flex: 1, textAlign: "right" },
  cPrice: { flex: 2, textAlign: "right" },
  cSum: { flex: 2, textAlign: "right" },
  totals: {
    marginTop: 12,
    alignSelf: "flex-end",
    width: "50%",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalLabel: {
    color: COLORS.muted,
  },
  grandRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.text,
    marginTop: 4,
    paddingTop: 6,
  },
  grandLabel: {
    fontFamily: "Roboto",
    fontWeight: "bold",
    fontSize: 12,
  },
  grandValue: {
    fontFamily: "Roboto",
    fontWeight: "bold",
    fontSize: 12,
    color: COLORS.accent,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: "center",
    fontSize: 8,
    color: COLORS.muted,
  },
});

// ---------------------------------------------------------------------------
// Хелперы
// ---------------------------------------------------------------------------

function fmtMoney(cents: number, currency: string, locale: Locale): string {
  const value = (cents / 100).toLocaleString(LABELS[locale].locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${value} ${currency}`;
}

function fmtDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function statusLabel(status: string, t: Record<string, string>): string {
  const key = STATUS_LABEL_KEY[status];
  return key ? (t[key] ?? status) : status;
}

function deliveryLabel(method: string, t: Record<string, string>): string {
  return method === "courier" ? (t.courier ?? "") : (t.pickup ?? "");
}

function itemTitle(
  snapshot: AdminOrderDetail["items"][number]["snapshot"],
  t: Record<string, string>,
): string {
  const product = snapshot.product?.nameRu ?? t.productFallback ?? "Item";
  const parts = [snapshot.color, snapshot.size].filter(Boolean);
  return parts.length > 0 ? `${product} (${parts.join(", ")})` : product;
}

// ---------------------------------------------------------------------------
// Компоненты
// ---------------------------------------------------------------------------

interface InvoiceProps {
  order: AdminOrderDetail;
  locale: Locale;
}

function InvoiceDocument({ order, locale }: InvoiceProps): React.ReactElement {
  const t = LABELS[locale];
  const subtotal = order.subtotalCents;
  const delivery = order.deliveryCostCents;
  const discount = order.discountCents;
  const total = order.totalCents;

  return (
    <Document
      title={`${t.title} ${order.number}`}
      author="Bigmax"
      creator="bigmax.uz"
      producer="bigmax.uz"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>BIGMAX</Text>
            </View>
            <Text style={styles.brandSub}>bigmax.uz</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.meta}>
              <Text style={styles.metaStrong}>
                {t.no} {order.number}
              </Text>
            </Text>
            <Text style={styles.meta}>
              {t.from} {fmtDate(order.createdAt)}
            </Text>
            <Text style={styles.meta}>
              {t.statusLabel}: {statusLabel(order.status, t)}
            </Text>
          </View>
        </View>

        <View style={styles.twoCols}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>{t.purchaser}</Text>
            <Text style={styles.fieldLabel}>{t.name}</Text>
            <Text style={styles.fieldValue}>{order.customer.name ?? "—"}</Text>
            <Text style={styles.fieldLabel}>{t.email}</Text>
            <Text style={styles.fieldValue}>{order.customer.email ?? "—"}</Text>
            <Text style={styles.fieldLabel}>{t.phone}</Text>
            <Text style={styles.fieldValue}>{order.customer.phone ?? "—"}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>{t.delivery}</Text>
            <Text style={styles.fieldLabel}>{t.method}</Text>
            <Text style={styles.fieldValue}>{deliveryLabel(order.deliveryMethod, t)}</Text>
            {order.address ? (
              <>
                <Text style={styles.fieldLabel}>{t.address}</Text>
                <Text style={styles.fieldValue}>
                  {[
                    order.address.region,
                    order.address.city,
                    order.address.district,
                    order.address.street,
                    order.address.house,
                    order.address.apartment ? `${t.apartment} ${order.address.apartment}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Text>
              </>
            ) : null}
            {order.branch ? (
              <>
                <Text style={styles.fieldLabel}>{t.branch}</Text>
                <Text style={styles.fieldValue}>{order.branch.nameRu}</Text>
                <Text style={styles.fieldValue}>{order.branch.addressRu}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.items}</Text>
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={[styles.th, styles.cName]}>{t.itemName}</Text>
              <Text style={[styles.th, styles.cQty]}>{t.qty}</Text>
              <Text style={[styles.th, styles.cPrice]}>{t.price}</Text>
              <Text style={[styles.th, styles.cSum]}>{t.sum}</Text>
            </View>
            {order.items.map((it) => (
              <View key={it.id} style={styles.tr}>
                <Text style={[styles.td, styles.cName]}>{itemTitle(it.snapshot, t)}</Text>
                <Text style={[styles.td, styles.cQty]}>{it.quantity}</Text>
                <Text style={[styles.td, styles.cPrice]}>
                  {fmtMoney(it.priceCents, order.currency, locale)}
                </Text>
                <Text style={[styles.td, styles.cSum]}>
                  {fmtMoney(it.priceCents * it.quantity, order.currency, locale)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t.subtotal}</Text>
              <Text>{fmtMoney(subtotal, order.currency, locale)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t.deliveryRow}</Text>
              <Text>{fmtMoney(delivery, order.currency, locale)}</Text>
            </View>
            {discount > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t.discount}</Text>
                <Text>−{fmtMoney(discount, order.currency, locale)}</Text>
              </View>
            ) : null}
            <View style={[styles.totalRow, styles.grandRow]}>
              <Text style={styles.grandLabel}>{t.total}</Text>
              <Text style={styles.grandValue}>{fmtMoney(total, order.currency, locale)}</Text>
            </View>
          </View>
        </View>

        {order.comment ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.comment}</Text>
            <Text style={styles.fieldValue}>{order.comment}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Bigmax · bigmax.uz · ${t.pageCounter} ${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

export async function renderOrderInvoicePdf(
  order: AdminOrderDetail,
  options: { locale?: string } = {},
): Promise<Buffer> {
  ensureFontsRegistered();
  const locale = pickLocale(options.locale ?? "ru");
  const buf = await renderToBuffer(<InvoiceDocument order={order} locale={locale} />);
  return buf;
}
