/**
 * Серверные хелперы для Order + Uniteller-redirect (P4-T5).
 *
 *   - `nextOrderSequenceForDay(date)` — следующий NNNN (1..9999) для заказов
 *     указанного дня; читает максимум из БД + 1. При гонке (Order.number
 *     unique) вызывающий код делает retry внутри Prisma-transaction.
 *   - `renderUnitellerRedirectHtml(action, fields)` — собирает HTML с
 *     self-submitting формой на Uniteller payUrl.
 *
 * Сервер-only. `@bigmax/payments.uniteller` использует `node:crypto` —
 * Next.js не пустит в client chunk.
 */

import { prisma } from "@bigmax/db";

/**
 * Следующий порядковый номер заказа `NNNN` для указанной даты (UTC).
 * Вычисляется как `MAX(sequence of orders for the day) + 1` через LIKE-запрос
 * по префиксу `BGX-YYYYMMDD-`.
 *
 * **Гонка**: если два запроса одновременно получат 0042 и попробуют создать,
 * один упадёт на unique-constraint `Order.number`. Вызывающий код обёрнут в
 * retry-loop (см. роут `/api/checkout/pay`).
 */
export async function nextOrderSequenceForDay(date: Date): Promise<number> {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const prefix = `BGX-${yyyy}${mm}${dd}-`;

  const latest = await prisma.order.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  if (!latest) return 1;

  // Парсим последние 4 символа номера — уже валидированы регуляркой
  // в момент записи (buildOrderNumber), поэтому парсинг безопасен.
  const tail = latest.number.slice(prefix.length);
  const n = Number.parseInt(tail, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n + 1;
}

/**
 * Строит HTML-страницу со self-submitting формой на `action` (Uniteller
 * payUrl). Поля передаются через `<input type=hidden>`. JS автоматически
 * сабмитит форму; `<noscript>` fallback — ручная кнопка.
 *
 * Возвращается `string` с полным HTML-документом. Route handler оборачивает
 * в `NextResponse` с `Content-Type: text/html; charset=utf-8`.
 *
 * Безопасность: все значения экранируются в HTML-атрибутах через
 * `escapeHtmlAttr`. Ни одно поле не попадает в HTML-body напрямую.
 */
export function renderUnitellerRedirectHtml(
  action: string,
  fields: Record<string, string | number>,
): string {
  const inputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtmlAttr(name)}" value="${escapeHtmlAttr(String(value))}">`,
    )
    .join("\n      ");

  // `lang` не локализуем — это служебная страница-редирект, юзер её не видит
  // больше секунды.
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <title>Переадресация в Uniteller…</title>
</head>
<body>
  <form id="uniteller-redirect" action="${escapeHtmlAttr(action)}" method="POST" accept-charset="utf-8">
      ${inputs}
    <noscript>
      <p>Для продолжения оплаты нажмите кнопку:</p>
      <button type="submit">Перейти к оплате</button>
    </noscript>
  </form>
  <script>document.getElementById('uniteller-redirect').submit();</script>
</body>
</html>
`;
}

/**
 * Экранирует значение для вставки в HTML-атрибут (двойные кавычки).
 * Достаточно для `name`/`value` inputs в self-submit форме.
 */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
