/**
 * `/admin/customers/[id]` — детальная страница клиента (P6-T8).
 *
 * Секции:
 *  - Header: name + email/phone + role-badge.
 *  - Profile: dl с языком, роли, баланс лояльности, totalSpent, createdAt.
 *  - Actions: <RoleChanger> + <ResetPasswordDialog>.
 *  - Recent orders (last 10).
 *  - Addresses.
 *  - Loyalty transactions (last 20).
 *  - Saved cards.
 */

import { Link } from "@bigmax/i18n/navigation";
import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { AdminBreadcrumbs } from "@/components/admin/admin-breadcrumbs";
import { BlockToggleDialog } from "@/components/admin/customers/block-toggle-dialog";
import { ResetPasswordDialog } from "@/components/admin/customers/reset-password-dialog";
import { RoleChanger } from "@/components/admin/customers/role-changer";
import { OrderStatusBadge } from "@/components/admin/orders/order-status-badge";
import { getAdminCustomer } from "@/server/admin-customers";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string; id: string };
}

const ROLE_TONE: Record<string, string> = {
  admin: "bg-rose-100 text-rose-800 ring-rose-200",
  manager: "bg-violet-100 text-violet-800 ring-violet-200",
  customer: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default async function AdminCustomerDetailPage({ params }: PageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  const customer = await getAdminCustomer(params.id);
  if (!customer) notFound();

  const session = await auth();
  const isSelf = session?.user.id === customer.id;

  const t = await getTranslations("admin.customers.detail");
  const tRole = await getTranslations("admin.customers.roles");
  const tLoyalty = await getTranslations("admin.customers.loyaltyTypes");

  const fmtMoney = (cents: number, currency = "UZS"): string =>
    `${(cents / 100).toLocaleString("ru-RU")} ${currency}`;
  const fmtDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="space-y-6" data-testid="admin-customer-detail">
      <AdminBreadcrumbs
        items={[
          { labelKey: "customers", href: "/admin/customers" },
          { label: customer.name ?? customer.email ?? customer.id },
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/customers"
            className="text-sm text-muted-foreground hover:underline"
            data-testid="admin-customer-back"
          >
            {t("back")}
          </Link>
          <h2 className="text-2xl font-semibold">{customer.name ?? t("noName")}</h2>
          <p className="text-sm text-muted-foreground">
            {customer.email ?? "—"} · {customer.phone ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.isBlocked ? (
            <span
              className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-800 ring-1 ring-inset ring-rose-200"
              data-testid="admin-customer-blocked-badge"
            >
              {t("blockedBadge")}
            </span>
          ) : null}
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${
              ROLE_TONE[customer.role] ?? ROLE_TONE["customer"]
            }`}
            data-testid="admin-customer-role-badge"
          >
            {tRole(customer.role)}
          </span>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4" data-testid="admin-customer-profile">
          <h3 className="mb-2 text-sm font-semibold">{t("profile.title")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("profile.language")}</dt>
            <dd>{customer.language}</dd>
            <dt className="text-muted-foreground">{t("profile.loyaltyPoints")}</dt>
            <dd className="font-mono">{customer.loyaltyPoints}</dd>
            <dt className="text-muted-foreground">{t("profile.totalSpent")}</dt>
            <dd className="font-mono">{fmtMoney(customer.totalSpentCents)}</dd>
            <dt className="text-muted-foreground">{t("profile.ordersCount")}</dt>
            <dd className="font-mono">{customer.ordersCount}</dd>
            <dt className="text-muted-foreground">{t("profile.createdAt")}</dt>
            <dd>{fmtDate(customer.createdAt)}</dd>
            <dt className="text-muted-foreground">{t("profile.updatedAt")}</dt>
            <dd>{fmtDate(customer.updatedAt)}</dd>
          </dl>
        </section>

        <section className="space-y-3">
          <RoleChanger userId={customer.id} currentRole={customer.role} isSelf={isSelf} />
          <div className="rounded-lg border p-4">
            <h3 className="mb-2 text-sm font-semibold">{t("actions.title")}</h3>
            <div className="flex flex-wrap gap-2">
              <ResetPasswordDialog userId={customer.id} hasPassword />
              <BlockToggleDialog
                userId={customer.id}
                isBlocked={customer.isBlocked}
                isSelf={isSelf}
              />
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border" data-testid="admin-customer-orders">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">
          {t("orders.title", { count: customer.ordersCount })}
        </h3>
        {customer.recentOrders.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("orders.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("orders.number")}</th>
                <th className="px-3 py-2 text-left">{t("orders.createdAt")}</th>
                <th className="px-3 py-2 text-right">{t("orders.total")}</th>
                <th className="px-3 py-2 text-left">{t("orders.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customer.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {o.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(o.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(o.totalCents, o.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <OrderStatusBadge status={o.status as never} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border" data-testid="admin-customer-addresses">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">
          {t("addresses.title", { count: customer.addressesCount })}
        </h3>
        {customer.addresses.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("addresses.empty")}</p>
        ) : (
          <ul className="divide-y">
            {customer.addresses.map((a) => (
              <li key={a.id} className="px-4 py-2 text-sm">
                {a.isDefault ? (
                  <span className="mr-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    {t("addresses.default")}
                  </span>
                ) : null}
                {[
                  a.region,
                  a.city,
                  a.district,
                  a.street,
                  a.house,
                  a.apartment ? `кв. ${a.apartment}` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border" data-testid="admin-customer-loyalty">
        <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("loyalty.title")}</h3>
        {customer.loyaltyTxs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("loyalty.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("loyalty.when")}</th>
                <th className="px-3 py-2 text-left">{t("loyalty.type")}</th>
                <th className="px-3 py-2 text-left">{t("loyalty.order")}</th>
                <th className="px-3 py-2 text-right">{t("loyalty.points")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customer.loyaltyTxs.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(tx.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">{tLoyalty(tx.type)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{tx.orderNumber ?? "—"}</td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-medium ${tx.points >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {tx.points > 0 ? "+" : ""}
                    {tx.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {customer.savedCards.length > 0 ? (
        <section className="rounded-lg border" data-testid="admin-customer-cards">
          <h3 className="border-b px-4 py-2 text-sm font-semibold">{t("cards.title")}</h3>
          <ul className="divide-y">
            {customer.savedCards.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  <span className="font-mono">**** **** **** {c.panLast4}</span>{" "}
                  <span className="ml-2 text-xs uppercase text-muted-foreground">{c.brand}</span>
                  {c.isDefault ? (
                    <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      {t("cards.default")}
                    </span>
                  ) : null}
                </span>
                {c.isBlocked ? (
                  <span className="text-xs text-rose-700">{t("cards.blocked")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
