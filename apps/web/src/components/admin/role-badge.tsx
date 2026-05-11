/**
 * `<RoleBadge>` — маленький бейдж в header'е админки, показывает роль
 * текущего юзера (P6-T1). Pure server component. Иконка из
 * `CUSTOMER_ROLE_META` для консистентности с filter-select'ом.
 */

import { useTranslations } from "next-intl";

import { CUSTOMER_ROLE_META } from "@/components/admin/status-meta";

export type AdminRole = "admin" | "manager";

const TONE: Record<AdminRole, string> = {
  admin: "bg-rose-100 text-rose-800 ring-rose-200",
  manager: "bg-indigo-100 text-indigo-800 ring-indigo-200",
};

export function RoleBadge({ role }: { role: AdminRole }): JSX.Element {
  const t = useTranslations("admin.roles");
  const Icon = CUSTOMER_ROLE_META[role]?.icon;
  return (
    <span
      data-testid="admin-role-badge"
      data-role={role}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[role]}`}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {t(role)}
    </span>
  );
}
