/**
 * P7-T2 · /account/loyalty — баланс «Бигмах Бонус» + история транзакций.
 *
 * Server-rendered, auth-gated через layout. Paginated через `?page=N`.
 * Read-only — все начисления/списания происходят атомарно в checkout/pay
 * (spend) и Uniteller webhook / COD-`delivered` (earn).
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale, type Locale } from "@bigmax/shared-types";
import { ArrowDownCircle, ArrowUpCircle, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import {
  getAccountLoyalty,
  parseLoyaltyHistoryQuery,
  LOYALTY_HISTORY_PAGE_SIZE,
} from "@/server/account-loyalty";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export const dynamic = "force-dynamic";

export default async function AccountLoyaltyPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const session = await auth();
  if (!session?.user.id) notFound();

  const { page } = parseLoyaltyHistoryQuery(searchParams);
  const result = await getAccountLoyalty(session.user.id, page);

  const t = await getTranslations("account.loyalty");
  const formatter = await getFormatter({ locale });

  return (
    <div className="space-y-6" data-testid="account-loyalty">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <section className="rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("balanceLabel")}
            </p>
            <p
              className="font-mono text-3xl font-bold tabular-nums"
              data-testid="account-loyalty-balance"
            >
              {t("balanceValue", { points: result.balance })}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("rulesHint")}</p>
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{t("historyTitle")}</h2>
          {result.total > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("historyCount", { count: result.total })}
            </p>
          ) : null}
        </header>

        {result.items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="account-loyalty-history">
            {result.items.map((tx) => {
              const meta = txMeta(tx.type);
              const Icon = meta.Icon;
              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
                  data-tx-type={tx.type}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={"h-5 w-5 " + meta.iconClass} aria-hidden />
                    <div>
                      <p className="text-sm font-medium">{t(meta.labelKey)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatter.dateTime(tx.createdAt, "long")}
                        {tx.orderNumber ? (
                          <>
                            {" · "}
                            {tx.orderId ? (
                              <Link
                                href={`/account/orders/${tx.orderId}` as never}
                                className="font-mono text-primary hover:underline"
                              >
                                {tx.orderNumber}
                              </Link>
                            ) : (
                              <span className="font-mono">{tx.orderNumber}</span>
                            )}
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <p
                    className={"font-mono text-base font-semibold tabular-nums " + meta.amountClass}
                  >
                    {tx.points > 0 ? "+" : ""}
                    {tx.points}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {result.pageCount > 1 ? (
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            tPrev={t("pagination.prev")}
            tNext={t("pagination.next")}
            tPageOf={t("pagination.pageOf", {
              page: result.page,
              total: result.pageCount,
            })}
          />
        ) : null}
      </section>

      <p className="text-[11px] text-muted-foreground">
        {t("pageSizeHint", { size: LOYALTY_HISTORY_PAGE_SIZE })}
      </p>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  tPrev,
  tNext,
  tPageOf,
}: {
  page: number;
  pageCount: number;
  tPrev: string;
  tNext: string;
  tPageOf: string;
}): JSX.Element {
  return (
    <nav aria-label="pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <Link
        aria-disabled={page <= 1}
        className={
          page <= 1 ? "pointer-events-none text-muted-foreground" : "text-primary hover:underline"
        }
        href={`/account/loyalty?page=${page - 1}` as unknown as never}
      >
        {tPrev}
      </Link>
      <span className="text-muted-foreground" data-testid="account-loyalty-page-of">
        {tPageOf}
      </span>
      <Link
        aria-disabled={page >= pageCount}
        className={
          page >= pageCount
            ? "pointer-events-none text-muted-foreground"
            : "text-primary hover:underline"
        }
        href={`/account/loyalty?page=${page + 1}` as unknown as never}
      >
        {tNext}
      </Link>
    </nav>
  );
}

/**
 * P7-T2 sub-task A: визуал для всех четырёх типов транзакций.
 *  - earn     → ⬆ emerald (поступление)
 *  - spend    → ⬇ amber   (списание)
 *  - refund   → ↩ blue    (возврат spend'а при cancel/refund)
 *  - clawback → 🔄 rose   (изъятие earn'а при cancel/refund)
 */
function txMeta(type: "earn" | "spend" | "refund" | "clawback"): {
  Icon: typeof ArrowUpCircle;
  iconClass: string;
  amountClass: string;
  labelKey: "typeEarn" | "typeSpend" | "typeRefund" | "typeClawback";
} {
  switch (type) {
    case "earn":
      return {
        Icon: ArrowUpCircle,
        iconClass: "text-emerald-600 dark:text-emerald-400",
        amountClass: "text-emerald-700 dark:text-emerald-400",
        labelKey: "typeEarn",
      };
    case "spend":
      return {
        Icon: ArrowDownCircle,
        iconClass: "text-amber-600 dark:text-amber-400",
        amountClass: "text-amber-700 dark:text-amber-400",
        labelKey: "typeSpend",
      };
    case "refund":
      return {
        Icon: Undo2,
        iconClass: "text-sky-600 dark:text-sky-400",
        amountClass: "text-sky-700 dark:text-sky-400",
        labelKey: "typeRefund",
      };
    case "clawback":
      return {
        Icon: RotateCcw,
        iconClass: "text-rose-600 dark:text-rose-400",
        amountClass: "text-rose-700 dark:text-rose-400",
        labelKey: "typeClawback",
      };
  }
}
