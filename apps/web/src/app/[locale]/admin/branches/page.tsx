import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { MapPin, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminBranches } from "@/server/admin-taxonomy";

export const dynamic = "force-dynamic";

export default async function AdminBranchesPage({
  params,
}: {
  params: { locale: string };
}): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);
  const items = await getAdminBranches();
  const t = await getTranslations("admin.branches.list");

  return (
    <div className="space-y-6" data-testid="admin-branches">
      <AdminBreadcrumbs items={[{ labelKey: "branches" }]} />
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/admin/branches/new" data-testid="admin-branches-create">
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t("create")}
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <AdminEmptyState icon={MapPin} title={t("empty")} />
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="admin-branches-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.address")}</TableHead>
                <TableHead>{t("table.phone")}</TableHead>
                <TableHead className="text-center">{t("table.geo")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => (
                <TableRow key={b.id} data-testid="admin-branches-row" data-id={b.id}>
                  <TableCell>
                    <Link
                      href={`/admin/branches/${b.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {b.nameRu}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.addressRu}</TableCell>
                  <TableCell className="font-mono text-xs">{b.phone ?? "—"}</TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {b.hasGeo ? t("geoYes") : t("geoNo")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={b.isActive ? "success" : "muted"}>
                      {b.isActive ? t("active") : t("inactive")}
                    </Badge>
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
