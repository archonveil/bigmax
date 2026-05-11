/**
 * P7-T1 · /admin/promo — список промокодов с поиском, фильтром «активные»,
 * сортировкой и server-pagination'ом. Pattern по [admin/brands/page.tsx]
 * для consistency.
 */

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, isLocale, type Locale } from "@bigmax/shared-types";
import { Megaphone, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAdminPromos,
  parseAdminPromoListQuery,
  type AdminPromoListItem,
} from "@/server/admin-promo";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function AdminPromoPage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const query = parseAdminPromoListQuery(searchParams);
  const result = await getAdminPromos(query);
  const t = await getTranslations("admin.promo.list");
  const tTypes = await getTranslations("admin.promo.types");
  const tStatus = await getTranslations("admin.promo.status");

  return (
    <div className="space-y-6" data-testid="admin-promo">
      <AdminBreadcrumbs items={[{ labelKey: "promo" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/admin/promo/new" data-testid="admin-promo-create">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t("create")}
            </Link>
          </Button>
        }
      />

      {result.items.length === 0 ? (
        <AdminEmptyState icon={Megaphone} title={t("empty")} />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-promo-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.code")}</TableHead>
                <TableHead>{t("table.type")}</TableHead>
                <TableHead className="text-right">{t("table.value")}</TableHead>
                <TableHead className="text-right">{t("table.minOrder")}</TableHead>
                <TableHead className="text-right">{t("table.usage")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id} data-testid="admin-promo-row" data-id={p.id}>
                  <TableCell>
                    <Link
                      href={`/admin/promo/${p.id}`}
                      className="font-mono text-sm font-semibold text-primary hover:underline"
                    >
                      {p.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tTypes(p.type)}</TableCell>
                  <TableCell className="text-right font-mono">{renderValue(p, locale)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {p.minOrderCents > 0 ? formatCurrencyUzs(p.minOrderCents, locale) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {p.usageLimit === null
                      ? t("usageUnlimited", { used: p.usedCount })
                      : t("usageOfLimit", { used: p.usedCount, limit: p.usageLimit })}
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      active={p.isActive}
                      label={tStatus(p.isActive ? "active" : "inactive")}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function renderValue(p: AdminPromoListItem, locale: Locale): string {
  switch (p.type) {
    case "percent":
      return `${p.value}%`;
    case "fixed":
      return formatCurrencyUzs(p.value, locale);
    case "free_delivery":
    default:
      return "—";
  }
}

function StatusPill({ active, label }: { active: boolean; label: string }): JSX.Element {
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"
          : "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
      }
    >
      {label}
    </span>
  );
}
