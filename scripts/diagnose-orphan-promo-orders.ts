/**
 * P7-T1 sub-task C: Диагностика «осиротевших» промо-заказов.
 *
 * До P7-T1 у Order не было поля `promoCode`. Если в продакшене существуют
 * Order-записи с `discountCents > 0` (промо был применён) и `promoCode IS NULL`
 * (попали в БД до миграции `20260511120000_order_promo_code`), то на их
 * `shipped → delivered` переходе COD-капчура корректно поставит Payment в
 * `captured`, но `incrementPromoUsage` будет no-op — потому что snapshot'а
 * кода нет. Net: `Promo.usedCount` отстанет от реальности на 1 на каждом
 * таком заказе → один лишний redemption может проскочить через `usageLimit`.
 *
 * Script — **read-only**: считает affected orders + печатает sample. НЕ
 * пытается auto-attribute код — для этого нет source-of-truth (старая
 * `pay/route.ts` не сохраняла промо нигде, кроме как в `discountCents`).
 * Admin принимает решение вручную: либо смириться (новые промо все
 * корректно учитываются), либо вручную +1 к `Promo.usedCount` для известных
 * затронутых лимитированных промо.
 *
 * Запуск:
 *   pnpm tsx scripts/diagnose-orphan-promo-orders.ts
 *   pnpm tsx scripts/diagnose-orphan-promo-orders.ts --sample=20
 *
 * Exit codes:
 *   0 — найдено 0 orphan-заказов (всё чисто).
 *   1 — найдены orphan-заказы; вывод на stdout.
 *   2 — ошибка БД или окружения.
 */

/* eslint-disable no-console -- script intentionally prints to stdout */

// eslint-disable-next-line import/no-unresolved -- workspace package; resolver scoped to apps/*/packages/* tsconfigs, not root scripts/.
import { prisma } from "@bigmax/db";

interface OrphanSample {
  id: string;
  number: string;
  status: string;
  discountCents: number;
  createdAt: Date;
}

function parseSampleSize(): number {
  const arg = process.argv.find((a) => a.startsWith("--sample="));
  if (!arg) return 10;
  const n = Number.parseInt(arg.slice("--sample=".length), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 10;
}

async function main(): Promise<number> {
  const sampleSize = parseSampleSize();

  const total = await prisma.order.count({
    where: { promoCode: null, discountCents: { gt: 0n } },
  });

  if (total === 0) {
    console.log("[diagnose-orphan-promo] OK — no orphan-promo orders found.");
    return 0;
  }

  const sample: OrphanSample[] = await prisma.order.findMany({
    where: { promoCode: null, discountCents: { gt: 0n } },
    orderBy: { createdAt: "desc" },
    take: sampleSize,
    select: {
      id: true,
      number: true,
      status: true,
      discountCents: true,
      createdAt: true,
    },
  });

  console.warn(`[diagnose-orphan-promo] Found ${total} orphan-promo order(s).`);
  console.warn(`[diagnose-orphan-promo] These orders had a promo applied before P7-T1, but no`);
  console.warn(`[diagnose-orphan-promo] code snapshot was saved → Promo.usedCount won't be`);
  console.warn(`[diagnose-orphan-promo] auto-bumped on their delivered-transition.`);
  console.warn("");
  console.warn(`[diagnose-orphan-promo] Newest ${Math.min(sampleSize, total)} affected order(s):`);
  console.warn("");
  console.warn("  number              status     discountCents    createdAt");
  console.warn("  ──────────────────  ─────────  ───────────────  ──────────────────────────");
  for (const o of sample) {
    const d = String(o.discountCents).padStart(15, " ");
    const status = o.status.padEnd(9, " ");
    const number = o.number.padEnd(18, " ");
    console.warn(`  ${number}  ${status}  ${d}  ${o.createdAt.toISOString()}`);
  }
  console.warn("");
  console.warn(`[diagnose-orphan-promo] Action: manually decide whether to top up`);
  console.warn(`[diagnose-orphan-promo] Promo.usedCount for any limited promo whose`);
  console.warn(`[diagnose-orphan-promo] redemption history might collide with these`);
  console.warn(`[diagnose-orphan-promo] orders. New orders (post P7-T1) are correctly`);
  console.warn(`[diagnose-orphan-promo] tracked via Order.promoCode → no further action`);
  console.warn(`[diagnose-orphan-promo] needed for go-forward.`);

  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error("[diagnose-orphan-promo] ERROR", err);
    process.exitCode = 2;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
