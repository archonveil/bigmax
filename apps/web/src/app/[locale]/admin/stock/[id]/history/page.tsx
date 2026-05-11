/**
 * `/admin/stock/[id]/history` — полная история изменений Stock-row'а
 * (P6-T7 follow-up — closes (c)).
 *
 * Page-size 50, pagination через `?page=N`. Header показывает текущее
 * состояние (qty/reserved/available + product info), table — все
 * StockLog с action / delta / reason / admin / time.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { getAdminStockEntry, getAdminStockHistory } from "@/server/admin-stock";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminStockHistoryPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const entry = await getAdminStockEntry(params.id);
  if (!entry) notFound();

  const pageRaw = pickFirst(searchParams?.["page"]);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  const history = await getAdminStockHistory(params.id, page);
  const t = await getTranslations("admin.stock.history");
  const tList = await getTranslations("admin.stock.list");

  const fmtDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");
  const variantParts = [entry.color, entry.size].filter(Boolean).join(" · ") || "—";

  return (
    <div className="space-y-6" data-testid="admin-stock-history">
      <AdminBreadcrumbs
        items={[
          { labelKey: "stock", href: "/admin/stock" },
          { label: `${entry.sku} · ${entry.branchNameRu}` },
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/admin/stock?branchId=${entry.branchId}`}
            className="text-sm text-muted-foreground hover:underline"
            data-testid="admin-stock-history-back"
          >
            {t("back")}
          </Link>
          <h2 className="text-2xl font-semibold">{t("title", { sku: entry.sku })}</h2>
          <p className="text-sm text-muted-foreground">
            {entry.productNameRu} · {variantParts} · {entry.branchNameRu}
          </p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{tList("table.quantity")}</dt>
            <dd className="font-mono text-lg">{entry.quantity}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{tList("table.reserved")}</dt>
            <dd className="font-mono text-lg text-muted-foreground">{entry.reserved}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{tList("table.available")}</dt>
            <dd
              className={`font-mono text-lg ${entry.isLow ? "font-semibold text-amber-700" : ""}`}
            >
              {entry.available}
            </dd>
          </div>
        </dl>
      </header>

      <p className="text-xs text-muted-foreground">{t("summary", { count: history.total })}</p>

      {history.items.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="admin-stock-history-empty"
        >
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="admin-stock-history-table">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("table.when")}</th>
                <th className="px-3 py-2 text-left">{t("table.action")}</th>
                <th className="px-3 py-2 text-right">{t("table.qty")}</th>
                <th className="px-3 py-2 text-right">{t("table.reserved")}</th>
                <th className="px-3 py-2 text-left">{t("table.admin")}</th>
                <th className="px-3 py-2 text-left">{t("table.reason")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.items.map((l) => (
                <tr key={l.id} data-testid="admin-stock-history-row" data-action={l.action}>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(l.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    data-testid="admin-stock-history-qty"
                  >
                    <span className="text-muted-foreground">{l.oldQty}</span>{" "}
                    <span
                      className={`font-medium ${l.delta > 0 ? "text-emerald-700" : l.delta < 0 ? "text-rose-700" : "text-muted-foreground"}`}
                    >
                      {l.delta > 0 ? "↑+" : l.delta < 0 ? "↓" : "·"}
                      {l.delta !== 0 ? Math.abs(l.delta) : ""}
                    </span>{" "}
                    <span>{l.newQty}</span>
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    data-testid="admin-stock-history-reserved"
                  >
                    <span className="text-muted-foreground">{l.oldReserved}</span>{" "}
                    <span
                      className={`font-medium ${l.reservedDelta > 0 ? "text-sky-700" : l.reservedDelta < 0 ? "text-violet-700" : "text-muted-foreground"}`}
                    >
                      {l.reservedDelta > 0 ? "↑+" : l.reservedDelta < 0 ? "↓" : "·"}
                      {l.reservedDelta !== 0 ? Math.abs(l.reservedDelta) : ""}
                    </span>{" "}
                    <span>{l.newReserved}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{l.adminEmail ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{l.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.pageCount > 1 ? <Pagination history={history} stockId={params.id} /> : null}
    </div>
  );
}

async function Pagination({
  history,
  stockId,
}: {
  history: { page: number; pageCount: number };
  stockId: string;
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string =>
    p > 1 ? `/admin/stock/${stockId}/history?page=${p}` : `/admin/stock/${stockId}/history`;
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-stock-history-pagination"
    >
      {history.page > 1 ? (
        <Link className="text-primary hover:underline" href={buildHref(history.page - 1)}>
          ← {t("prev")}
        </Link>
      ) : (
        <span className="text-muted-foreground">← {t("prev")}</span>
      )}
      <span className="text-muted-foreground">
        {t("page", { page: history.page, total: history.pageCount })}
      </span>
      {history.page < history.pageCount ? (
        <Link className="text-primary hover:underline" href={buildHref(history.page + 1)}>
          {t("next")} →
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("next")} →</span>
      )}
    </nav>
  );
}
