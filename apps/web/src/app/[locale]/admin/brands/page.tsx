import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { Award, Plus } from "lucide-react";
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
import { getAdminBrands } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminBrandsPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const items = await getAdminBrands();
  const t = await getTranslations("admin.brands.list");

  return (
    <div className="space-y-6" data-testid="admin-brands">
      <AdminBreadcrumbs items={[{ labelKey: "brands" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/admin/brands/new" data-testid="admin-brands-create">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t("create")}
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <AdminEmptyState icon={Award} title={t("empty")} />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-brands-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.slug")}</TableHead>
                <TableHead>{t("table.country")}</TableHead>
                <TableHead className="text-right">{t("table.products")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => (
                <TableRow key={b.id} data-testid="admin-brands-row" data-id={b.id}>
                  <TableCell>
                    <Link
                      href={`/admin/brands/${b.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {b.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {b.slug}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.country ?? t("noCountry")}
                  </TableCell>
                  <TableCell className="text-right font-mono">{b.productCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
