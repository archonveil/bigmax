/**
 * `/admin/audit` — admin audit log (P6-T8 follow-up — closes (c)).
 *
 * SSR с querystring `?group=&q=&from=&to=&page=N`. Page-size 50.
 * Группирует все admin-driven события из PaymentLog в одной timeline.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { ScrollText } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AuditFilters } from "@/components/admin/audit/audit-filters";
import { AUDIT_GROUP_META } from "@/components/admin/status-meta";
import { Highlight } from "@/components/highlight";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminAuditLog, parseAdminAuditQuery } from "@/server/admin-audit";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

/** Same prefix-rule as `AUDIT_ACTION_GROUPS` в server/admin-audit.ts. */
function inferAuditGroup(action: string): keyof typeof AUDIT_GROUP_META | null {
  if (action.startsWith("user.")) return "user";
  if (action.startsWith("order.")) return "order";
  if (action.startsWith("refund_")) return "refund";
  if (action.startsWith("recheck_")) return "recheck";
  if (action.startsWith("cancel_")) return "cancel";
  if (action.startsWith("webhook")) return "webhook";
  return null;
}

function statusTone(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code >= 500) return "text-rose-700";
  if (code >= 400) return "text-amber-700";
  if (code >= 200 && code < 300) return "text-emerald-700";
  return "text-muted-foreground";
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const query = parseAdminAuditQuery(searchParams);
  const result = await getAdminAuditLog(query);
  const t = await getTranslations("admin.audit");

  const fmtDate = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

  return (
    <div className="space-y-6" data-testid="admin-audit">
      <AdminBreadcrumbs items={[{ label: t("title") }]} />
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      <AuditFilters query={query} />

      <p className="text-xs text-muted-foreground">{t("summary", { count: result.total })}</p>

      {result.items.length === 0 ? (
        <AdminEmptyState icon={ScrollText} title={t("empty")} testId="admin-audit-empty" />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.when")}</TableHead>
                <TableHead>{t("table.action")}</TableHead>
                <TableHead className="text-right">{t("table.status")}</TableHead>
                <TableHead>{t("table.message")}</TableHead>
                <TableHead>{t("table.payment")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((e) => (
                <TableRow
                  key={e.id}
                  data-testid="admin-audit-row"
                  data-action={e.action}
                  className="align-top"
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDate(e.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {(() => {
                      const group = inferAuditGroup(e.action);
                      const meta = group ? AUDIT_GROUP_META[group] : null;
                      const Icon = meta?.icon;
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          {meta ? (
                            <span
                              aria-hidden
                              className={`inline-block h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                              title={group ?? ""}
                            />
                          ) : null}
                          {Icon ? (
                            <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                          ) : null}
                          <Highlight text={e.action} query={query.q} />
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${statusTone(e.statusCode)}`}>
                    {e.statusCode ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.errorMessage ? (
                      <Highlight text={e.errorMessage} query={query.q} />
                    ) : (
                      renderRequestSummary(e.request)
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.paymentId ? (
                      <span className="font-mono text-muted-foreground">
                        {e.paymentId.slice(0, 12)}…
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.pageCount > 1 ? <Pagination result={result} query={query} /> : null}
    </div>
  );
}

function renderRequestSummary(req: unknown): string {
  if (!req || typeof req !== "object") return "—";
  const r = req as Record<string, unknown>;
  // Распознаём наиболее частые fields для compact-summary'и в таблице.
  const parts: string[] = [];
  if (typeof r["orderId"] === "string") parts.push(`order=${(r["orderId"] as string).slice(0, 8)}`);
  if (typeof r["targetUserId"] === "string")
    parts.push(`user=${(r["targetUserId"] as string).slice(0, 8)}`);
  if (typeof r["from"] === "string" && typeof r["to"] === "string")
    parts.push(`${r["from"] as string}→${r["to"] as string}`);
  if (typeof r["oldRole"] === "string" && typeof r["newRole"] === "string")
    parts.push(`${r["oldRole"] as string}→${r["newRole"] as string}`);
  if (typeof r["amountCents"] === "number") parts.push(`${(r["amountCents"] as number) / 100} UZS`);
  if (typeof r["reason"] === "string" && (r["reason"] as string).length > 0)
    parts.push(`«${(r["reason"] as string).slice(0, 40)}»`);
  return parts.join(" · ") || "—";
}

async function Pagination({
  result,
  query,
}: {
  result: { page: number; pageCount: number };
  query: { group: string | null; q: string | null; from: Date | null; to: Date | null };
}): Promise<JSX.Element> {
  const t = await getTranslations("account.orders.list.pagination");
  const buildHref = (p: number): string => {
    const params = new URLSearchParams();
    if (query.group) params.set("group", query.group);
    if (query.q) params.set("q", query.q);
    if (query.from) params.set("from", query.from.toISOString().slice(0, 10));
    if (query.to) params.set("to", query.to.toISOString().slice(0, 10));
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/audit?${qs}` : `/admin/audit`;
  };
  return (
    <nav
      className="flex items-center justify-between border-t pt-4 text-sm"
      data-testid="admin-audit-pagination"
    >
      {result.page > 1 ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page - 1)}>
          ← {t("prev")}
        </Link>
      ) : (
        <span className="text-muted-foreground">← {t("prev")}</span>
      )}
      <span className="text-muted-foreground">
        {t("page", { page: result.page, total: result.pageCount })}
      </span>
      {result.page < result.pageCount ? (
        <Link className="text-primary hover:underline" href={buildHref(result.page + 1)}>
          {t("next")} →
        </Link>
      ) : (
        <span className="text-muted-foreground">{t("next")} →</span>
      )}
    </nav>
  );
}
